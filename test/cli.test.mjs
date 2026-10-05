import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '../bin/surfacemap.mjs');
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

function project(serverSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfacemap-cli-'));
  fs.writeFileSync(path.join(dir, 'server.js'), serverSource);
  const srcUrl = (f) => JSON.stringify(`file:///${path.join(SRC, f).replace(/\\/g, '/')}`);
  fs.writeFileSync(path.join(dir, 'surfacemap.config.mjs'), `
import { defineConfig } from ${srcUrl('config.mjs')};
import { routes, capabilities, extractors } from ${srcUrl('adapters/index.mjs')};
export default defineConfig({
  project: 'demo',
  adapters: [
    routes({ files: ['server.js'], extract: extractors.expressCalls }),
    capabilities({ rows: [{ id: 'hello', http: ['GET /hello'], cli: null, cliWhy: 'web only', dashboard: null, dashboardWhy: 'none' }] }),
  ],
});
`);
  return dir;
}

test('check fails when the map was never built, passes after build, fails again when the code moves', () => {
  const dir = project(`app.get('/hello', h);`);
  assert.equal(run(dir, 'check').status, 1, 'no files yet');
  assert.equal(run(dir, 'build').status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'docs/surfacemap.html')));
  const ok = run(dir, 'check');
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  fs.writeFileSync(path.join(dir, 'server.js'), `app.get('/hello', h); app.get('/new', h);`);
  const stale = run(dir, 'check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale/);
});

test('check ignores CRLF line endings in the committed files (autocrlf checkouts)', () => {
  const dir = project(`app.get('/hello', h);`);
  run(dir, 'build');
  for (const ext of ['html', 'json']) {
    const f = path.join(dir, `docs/surfacemap.${ext}`);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
  }
  assert.equal(run(dir, 'check').status, 0);
});

test('warnings do not fail check unless --fail-on warn', () => {
  const dir = project(`app.get('/hello', h); app.get('/unclaimed', h);`);
  run(dir, 'build');
  assert.equal(run(dir, 'check').status, 0);
  const strict = run(dir, 'check', '--fail-on', 'warn');
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /in-code-not-declared/);
});

test('init writes a starter config once and refuses to overwrite it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfacemap-init-'));
  assert.equal(run(dir, 'init').status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'surfacemap.config.mjs')));
  assert.equal(run(dir, 'init').status, 1);
});

test('usage errors exit 2 with a message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfacemap-none-'));
  assert.equal(run(dir, 'build').status, 2);
  assert.equal(run(dir, 'frobnicate').status, 2);
});
