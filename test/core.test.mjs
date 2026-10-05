import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGraph, detectDrift, buildGraph, renderHtml } from '../src/index.mjs';
import { routes, capabilities, commands, extractors } from '../src/adapters/index.mjs';
import { expandFiles } from '../src/files.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfacemap-'));
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };

test('graph: nodes and edges dedupe, origins merge, output is sorted and stable', () => {
  const g = createGraph({ project: 'p' });
  const a = g.addNode({ kind: 'http', key: 'GET /b', origin: 'code' });
  g.addNode({ kind: 'http', key: 'GET /b', origin: 'declared', meta: { x: 1 } });
  const c = g.addNode({ kind: 'capability', key: 'cap' });
  g.addNode({ kind: 'http', key: 'GET /a', origin: 'code' });
  g.addEdge(c, a, 'exposes'); g.addEdge(c, a, 'exposes');
  const json = g.toJSON();
  assert.deepEqual(json.nodes.map((n) => n.id), ['capability:cap', 'http:GET /a', 'http:GET /b']);
  assert.deepEqual(json.nodes[2].origins, ['code', 'declared']);
  assert.equal(json.edges.length, 1);
  assert.equal(JSON.stringify(json), JSON.stringify(g.toJSON()));
});

test('graph: an edge to a node that was never added is an error, not a silent hole', () => {
  const g = createGraph();
  g.addEdge('a:1', 'b:2');
  assert.throws(() => g.toJSON(), /never added/);
});

test('extractors read routes out of three common styles', () => {
  assert.deepEqual(extractors.literal(`x = 'GET /health'; y = "POST /a/:id"`), ['GET /health', 'POST /a/:id']);
  assert.deepEqual(extractors.expressCalls(`app.get('/users', h); router.post("/users/:id", h)`), ['GET /users', 'POST /users/:id']);
  assert.deepEqual(extractors.methodPattern("{ method: 'GET',\n pattern: /^\\/sessions\\/(\\d+)$/ }"), ['GET /sessions/:n']);
});

test('expandFiles: star in the last segment, missing patterns reported', () => {
  const dir = tmp();
  write(dir, 'routes-a.mjs', ''); write(dir, 'routes-b.mjs', ''); write(dir, 'other.mjs', ''); write(dir, 'src/x.js', '');
  const r = expandFiles(dir, ['routes-*.mjs', 'src/*.js', 'nope.js', 'nada-*.js']);
  assert.deepEqual(r.files, ['routes-a.mjs', 'routes-b.mjs', 'src/x.js']);
  assert.deepEqual(r.missing, ['nope.js', 'nada-*.js']);
});

test('adapters + drift: a route in code nobody exposes, and one declared but missing', async () => {
  const dir = tmp();
  write(dir, 'server.js', `app.get('/one', h); app.get('/two', h); app.post('/internal', h);`);
  const config = {
    project: 'demo',
    adapters: [
      routes({ files: ['server.js'], extract: extractors.expressCalls, internal: { 'POST /internal': 'plumbing' } }),
      commands({ rows: [{ cmd: 'one', mcp: 'tool.one', read: '/one' }, { cmd: 'nomcp', mcp: null }, { cmd: 'exempt', mcp: null, mcpExempt: 'process control' }] }),
      capabilities({ rows: [{ id: 'one', http: ['GET /one', 'GET /ghost'], cli: ['one'], dashboard: ['GET /one'] }, { id: 'quiet', http: [], cli: null }] }),
    ],
  };
  const g = await buildGraph(config, { root: dir });
  const codes = g.findings.map((f) => `${f.code}|${f.nodes[0] ?? ''}`);
  assert.ok(codes.includes('in-code-not-declared|http:GET /two'), codes.join('\n'));
  assert.ok(codes.includes('declared-not-in-code|http:GET /ghost'));
  assert.ok(codes.includes('cli-without-mcp|cli:nomcp'));
  assert.ok(codes.includes('gap-without-reason|capability:quiet'));
  assert.ok(!codes.includes('cli-without-mcp|cli:exempt'), 'mcpExempt silences cli-without-mcp');
  assert.ok(!codes.some((c) => c.includes('/internal')), 'an internal route is not unclaimed');
  assert.ok(g.edges.some((e) => e.from === 'cli:one' && e.to === 'mcp:tool.one' && e.kind === 'mirrors'));
  assert.ok(g.edges.some((e) => e.from === 'cli:one' && e.to === 'http:GET /one' && e.kind === 'reads'));
  assert.ok(g.edges.some((e) => e.from === 'dashboard:one' && e.to === 'http:GET /one' && e.kind === 'calls'));
});

test('drift: a kind with no declaration table produces no findings (one adapter at a time)', async () => {
  const dir = tmp();
  write(dir, 's.js', `app.get('/only', h)`);
  const g = await buildGraph({ project: 'p', adapters: [routes({ files: ['s.js'], extract: extractors.expressCalls })] }, { root: dir });
  assert.deepEqual(g.findings, []);
});

test('a missing route file is an error finding, not a crash', async () => {
  const g = await buildGraph({ project: 'p', adapters: [routes({ files: ['gone.js'] })] }, { root: tmp() });
  assert.equal(g.findings[0].level, 'error');
  assert.equal(g.findings[0].code, 'file-not-found');
});

test('render: deterministic, self-contained, and node names cannot break out of the script tag', async () => {
  const g = createGraph({ project: 'x <script> & "y"' });
  g.addNode({ kind: 'cli', key: '</script><img src=x onerror=alert(1)>', origin: 'code' });
  const graph = { ...g.toJSON(), purpose: '', columns: ['cli'], kinds: { cli: { label: 'CLI command', purpose: '' } } };
  const a = renderHtml(graph); const b = renderHtml(graph);
  assert.equal(a, b);
  assert.ok(!a.includes('</script><img'), 'raw closing tag leaked into the page');
  assert.ok(a.includes('x &lt;script&gt; &amp; &quot;y&quot; surface map'), 'title is escaped');
  const m = a.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  assert.equal(JSON.parse(m[1]).nodes[0].key, '</script><img src=x onerror=alert(1)>');
});
