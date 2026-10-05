// A small stand-in service for the live-mode demo. It is written the way many Express apps are, so surfacemap's
// `expressCalls` extractor finds its routes. It misbehaves on purpose, so the live view has something to show:
//   /orders    grows by one entry every few seconds (a count that moves)
//   /reports   always fails with 500
//   /search    answers slowly
//   /flaky     fails every third call
//   /legacy    is declared in the capability table but this service does not serve it (404)
import http from 'node:http';

const routes = [];
const app = {
  get: (path, handler) => routes.push(['GET', path, handler]),
  post: (path, handler) => routes.push(['POST', path, handler]),
};

const startedAt = Date.now();
let flakyCalls = 0;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

app.get('/health', (req, res) => json(res, 200, { ok: true }));
app.get('/orders', (req, res) => json(res, 200, Array.from({ length: 12 + Math.floor((Date.now() - startedAt) / 4000) }, (_, i) => ({ id: i + 1 }))));
app.post('/orders', (req, res) => json(res, 201, { id: 1 }));
app.get('/orders/:id', (req, res) => json(res, 200, { id: 1 }));
app.get('/customers', (req, res) => json(res, 200, { total: 340, page: 1, customers: [] }));
app.get('/reports', (req, res) => json(res, 500, { error: 'report store is down' }));
app.get('/search', (req, res) => setTimeout(() => json(res, 200, { results: [1, 2, 3, 4] }), 900));
app.get('/flaky', (req, res) => json(res, ++flakyCalls % 3 === 0 ? 503 : 200, { calls: flakyCalls }));

export function startService(port = 0) {
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const hit = routes.find(([m, p]) => m === req.method && new RegExp(`^${p.replace(/:\w+/g, '[^/]+')}$`).test(path));
    if (hit) return hit[2](req, res);
    return json(res, 404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
