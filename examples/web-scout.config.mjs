// Surface map for Web-Scout, the project this tool was extracted from. In Web-Scout itself, copy this to
// surfacemap.config.mjs, drop `root` and `from` (the files sit next to the config) and import 'surfacemap'.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { defineConfig } from '../src/config.mjs';
import { routes, capabilities, commands, extractors } from '../src/adapters/index.mjs';

const root = process.env.WEB_SCOUT_DIR ?? path.resolve(import.meta.dirname, '../../Web-Scout');
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { SURFACES, INTERNAL_ROUTES } = await load('surfaces.mjs');
const { CLI_SPEC } = await load('cli-spec.mjs');

export default defineConfig({
  project: 'Web-Scout',
  purpose: 'Every way to reach a Web-Scout feature - CLI, MCP, HTTP and the dashboard - and how they are wired. Built from cli-spec.mjs, surfaces.mjs and the relay source, so a command with no MCP twin or a route no capability claims shows up as a finding.',
  root,
  out: path.resolve(import.meta.dirname, 'out/web-scout'),
  adapters: [
    routes({ files: ['relay.mjs', 'routes-*.mjs'], extract: extractors.methodPattern, internal: INTERNAL_ROUTES }),
    commands({ rows: CLI_SPEC }),
    capabilities({ rows: SURFACES }),
  ],
});
