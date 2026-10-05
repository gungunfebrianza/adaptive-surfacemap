import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGraph } from '../src/graph.mjs';
import { probeTargets, probeOne, runProbes, summarize } from '../src/live.mjs';
import { startMapServer } from '../src/serve.mjs';
import { renderHtml } from '../src/render.mjs';
import { routes, capabilities, extractors } from '../src/adapters/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A stand-in for the service being mapped.
function fakeService() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/items') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify([1, 2, 3])); }
    if (req.url === '/stats') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ total: 7, other: [1] })); }
    if (req.url === '/boxes') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ name: 'x', boxes: [1, 2] })); }
    if (req.url === '/broken') { res.statusCode = 500; return res.end('boom'); }
    if (req.url === '/stream') { res.setHeader('content-type', 'text/event-stream'); res.write('data: hi\n\n'); return; } // never ends
    if (req.url === '/hang') return; // never answers
    if (req.url === '/big') { res.setHeader('content-type', 'application/json'); return res.end('['.padEnd(600 * 1024, '1,')); }
    res.statusCode = 404; res.end('no');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  })));
}

const graphOf = (keys) => { const g = createGraph({ project: 't' }); for (const key of keys) g.addNode({ kind: 'http', key, origin: 'code' }); return g.toJSON(); };

test('probeTargets only picks GET routes without parameters and says why it skipped the rest', () => {
  const g = graphOf(['GET /items', 'POST /items', 'GET /items/:n', 'GET /files/*', 'GET /secret']);
  const { targets, skipped } = probeTargets(g, { exclude: [/secret/] });
  assert.deepEqual(targets.map((t) => t.path), ['/items']);
  assert.match(skipped['http:POST /items'], /not a GET/);
  assert.match(skipped['http:GET /items/:n'], /parameter/);
  assert.match(skipped['http:GET /files/*'], /parameter/);
  assert.match(skipped['http:GET /secret'], /live.exclude/);
  assert.deepEqual(probeTargets(g, { include: ['^GET /items$'] }).targets.length, 1);
  assert.match(probeTargets(g, { include: ['nothing'] }).skipped['http:GET /items'], /live.include/);
});

test('summarize counts an array, a total, or the first array a body carries', () => {
  assert.deepEqual(summarize([1, 2]), { count: 2, countOf: 'items' });
  assert.deepEqual(summarize({ total: 7, other: [1] }), { count: 7, countOf: 'total' });
  assert.deepEqual(summarize({ name: 'x', boxes: [1, 2] }), { count: 2, countOf: 'boxes' });
  assert.deepEqual(summarize({ ok: true }), {});
  assert.deepEqual(summarize('text'), {});
});

test('probeOne reports status, counts, dead services, hangs, streams and huge bodies without throwing', async () => {
  const svc = await fakeService();
  try {
    const items = await probeOne(svc.url, '/items');
    assert.equal(items.status, 200); assert.equal(items.count, 3); assert.ok(items.ms >= 0);
    assert.equal((await probeOne(svc.url, '/stats')).count, 7);
    assert.equal((await probeOne(svc.url, '/broken')).status, 500);
    assert.equal((await probeOne(svc.url, '/nope')).status, 404);
    assert.equal((await probeOne(svc.url, '/stream', { timeoutMs: 1500 })).streaming, true);
    assert.equal((await probeOne(svc.url, '/hang', { timeoutMs: 200 })).error, 'timeout');
    assert.equal((await probeOne(svc.url, '/big')).truncated, true);
  } finally { await svc.close(); }
  const dead = await probeOne(svc.url, '/items', { timeoutMs: 500 });
  assert.ok(dead.error && dead.status === undefined, 'a stopped service is an error result');
});

test('runProbes sends only GET requests and skips what it cannot call safely', async () => {
  const svc = await fakeService();
  try {
    const g = graphOf(['GET /items', 'GET /broken', 'POST /items', 'GET /items/:n']);
    const out = await runProbes(g, { target: svc.url });
    assert.equal(out.results['http:GET /items'].count, 3);
    assert.equal(out.results['http:GET /broken'].status, 500);
    assert.deepEqual(Object.keys(out.skipped).sort(), ['http:GET /items/:n', 'http:POST /items']);
    assert.ok(svc.seen.every((s) => s.startsWith('GET ')), svc.seen.join());
    assert.equal(svc.seen.length, 2);
  } finally { await svc.close(); }
});

test('the served page turns live mode on, /__live probes the service, and a plain build stays static', async () => {
  const svc = await fakeService();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfacemap-live-'));
  fs.writeFileSync(path.join(dir, 'server.js'), `app.get('/items', h); app.get('/broken', h); app.post('/items', h);`);
  const config = {
    project: 'demo', purpose: '', kinds: {}, failOn: ['error'], root: dir, out: path.join(dir, 'docs/map'), live: { interval: 3 },
    adapters: [
      routes({ files: ['server.js'], extract: extractors.expressCalls }),
      capabilities({ rows: [{ id: 'items', http: ['GET /items', 'GET /broken'], cli: null, cliWhy: 'x', dashboard: null, dashboardWhy: 'x' }] }),
    ],
  };
  const map = await startMapServer({ config, target: svc.url, port: 0 });
  try {
    const page = await (await fetch(map.url)).text();
    assert.match(page, /"live":\{"target":"http:\/\/127\.0\.0\.1:\d+","interval":3\}/);
    const live = await (await fetch(`${map.url}__live`)).json();
    assert.equal(live.results['http:GET /items'].count, 3);
    assert.equal(live.results['http:GET /broken'].status, 500);
    assert.ok(live.skipped['http:POST /items']);
    assert.equal((await fetch(`${map.url}__live`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${map.url}nope`)).status, 404);
    assert.equal((await fetch(`${map.url}graph.json`)).status, 200);
    // the page is rebuilt from the files on each load
    fs.writeFileSync(path.join(dir, 'server.js'), `app.get('/items', h); app.get('/broken', h); app.get('/fresh', h);`);
    assert.match(await (await fetch(map.url)).text(), /GET \/fresh/);
  } finally { await map.close(); await svc.close(); }

  const noLive = await startMapServer({ config, target: null, port: 0 });
  try {
    assert.equal((await fetch(`${noLive.url}__live`)).status, 404);
    assert.doesNotMatch(await (await fetch(noLive.url)).text(), /"live":/);
  } finally { await noLive.close(); }
  await assert.rejects(startMapServer({ config, target: 'ftp://x', port: 0 }), /http:\/\/ or https:\/\//);

  const g = { project: 'p', nodes: [], edges: [], findings: [], columns: [], kinds: {}, purpose: '' };
  assert.doesNotMatch(renderHtml(g), /"live":/, 'a built file has no live switch, so it stays deterministic');
});
