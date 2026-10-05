import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraph } from '../src/index.mjs';
import { routes, capabilities, clientCalls, extractors } from '../src/adapters/index.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfacemap-cc-'));
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);

test('apiCalls: quotes, templates, ids, query strings, and a run-time path that is skipped', () => {
  const src = [
    "api('GET', '/health')",
    "api('POST', `/sessions/${id}/end`)",
    "api('GET', `/search${qs}`)",
    "api('GET', '/x?y=1')",
    "api('GET', '/friction/' + act)",
  ].join('\n');
  assert.deepEqual(extractors.apiCalls(src).sort(), ['GET /health', 'GET /search', 'GET /x', 'POST /sessions/:n/end']);
});

test('fetchCalls: method from the options, absolute URLs skipped; axiosCalls reads verb methods', () => {
  const src = "fetch('/a'); fetch('/b', { method: 'post', body: x }); fetch('https://other.example/c'); fetch(`/d/${id}`)";
  assert.deepEqual(extractors.fetchCalls(src), ['GET /a', 'POST /b', 'GET /d/:n']);
  assert.deepEqual(extractors.axiosCalls("axios.get('/u'); http.delete(`/u/${id}`); axios.get('https://x/y')"), ['GET /u', 'DELETE /u/:n']);
});

test('clientCalls + drift: a panel claims a route the client never calls, and the client calls one no panel claims', async () => {
  const dir = tmp();
  write(dir, 'server.js', "app.get('/a', h); app.get('/b', h); app.get('/c', h);");
  write(dir, 'ui.js', "api('GET', '/a'); api('GET', '/c'); api('GET', '/missing');");
  const g = await buildGraph({
    project: 'p',
    adapters: [
      routes({ files: ['server.js'], extract: extractors.expressCalls }),
      clientCalls({ files: ['ui.js'] }),
      capabilities({ rows: [{ id: 'cap', http: ['GET /a', 'GET /b', 'GET /c'], cli: null, cliWhy: 'x', dashboard: ['GET /a', 'GET /b'] }] }),
    ],
  }, { root: dir });
  const codes = g.findings.map((f) => `${f.code}|${f.nodes.at(-1)}`);
  assert.ok(codes.includes('declared-call-not-in-client|http:GET /b'), codes.join('\n'));
  assert.ok(codes.includes('client-call-undeclared|http:GET /c'));
  assert.ok(codes.includes('declared-not-in-code|http:GET /missing'), 'a client call to a route the server lacks');
  assert.ok(!codes.includes('declared-call-not-in-client|http:GET /a'), 'a call that both sides agree on is clean');
  assert.ok(g.edges.some((e) => e.from === 'client:ui.js' && e.to === 'http:GET /a' && e.kind === 'calls'));
  assert.equal(g.nodes.find((n) => n.id === 'client:ui.js').meta.calls, 3);
});

test('clientCalls alone adds no drift findings (no panels declared to compare against)', async () => {
  const dir = tmp();
  write(dir, 'ui.js', "api('GET', '/a')");
  const g = await buildGraph({ project: 'p', adapters: [clientCalls({ files: ['ui.js'] })] }, { root: dir });
  assert.deepEqual(g.findings, []);
});

test('normalize rewrites keys on both adapters so styles can be aligned (:n to :id)', async () => {
  const dir = tmp();
  write(dir, 'server.js', "app.get('/u/:id', h)");
  write(dir, 'ui.js', "api('GET', `/u/${id}`)");
  const toId = (k) => k.replace(':n', ':id');
  const g = await buildGraph({ project: 'p', adapters: [routes({ files: ['server.js'], extract: extractors.expressCalls }), clientCalls({ files: ['ui.js'], normalize: toId })] }, { root: dir });
  const http = g.nodes.filter((n) => n.kind === 'http');
  assert.equal(http.length, 1);
  assert.deepEqual(http[0].origins, ['code']);
});

test('a missing client file is an error finding', async () => {
  const g = await buildGraph({ project: 'p', adapters: [clientCalls({ files: ['nope.js'] })] }, { root: tmp() });
  assert.equal(g.findings[0].code, 'file-not-found');
});
