// npm run demo: start the misbehaving service, then serve the map with live mode pointed at it.
import path from 'node:path';
import { loadConfig } from '../../src/config.mjs';
import { startMapServer } from '../../src/serve.mjs';
import { startService } from './service.mjs';

const here = import.meta.dirname;
const service = await startService(Number(process.env.DEMO_SERVICE_PORT) || 0);
const config = await loadConfig(path.join(here, 'surfacemap.config.mjs'));
const map = await startMapServer({ config, target: service.url, port: Number(process.env.DEMO_PORT) || 4310 });
console.log(`demo service  ${service.url}`);
console.log(`surface map   ${map.url}?live   (or open ${map.url} and press "Go live")`);
console.log('Ctrl+C to stop');
