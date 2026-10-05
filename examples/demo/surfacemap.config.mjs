import { defineConfig } from '../../src/config.mjs';
import { routes, capabilities, extractors } from '../../src/adapters/index.mjs';

export default defineConfig({
  project: 'Demo shop',
  purpose: 'A tiny service that misbehaves on purpose. Run "npm run demo" and press Go live to watch the route dots and counts.',
  out: 'out/demo',
  live: { interval: 2, exclude: [/^GET \/health$/] },
  adapters: [
    routes({ files: ['service.mjs'], extract: extractors.expressCalls }),
    capabilities({
      rows: [
        { id: 'orders', http: ['GET /orders', 'POST /orders', 'GET /orders/:id'], cli: null, cliWhy: 'web only', dashboard: null, dashboardWhy: 'no UI yet' },
        { id: 'customers', http: ['GET /customers'], cli: null, cliWhy: 'web only', dashboard: null, dashboardWhy: 'no UI yet' },
        { id: 'reporting', http: ['GET /reports', 'GET /search'], cli: null, cliWhy: 'web only', dashboard: null, dashboardWhy: 'no UI yet' },
        { id: 'resilience', http: ['GET /flaky'], cli: null, cliWhy: 'demo only', dashboard: null, dashboardWhy: 'demo only' },
        { id: 'legacy-export', http: ['GET /legacy'], cli: null, cliWhy: 'removed', dashboard: null, dashboardWhy: 'removed' },
      ],
    }),
  ],
});
