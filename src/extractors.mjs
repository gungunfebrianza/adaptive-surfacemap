// Route extractors: (source text) => ["GET /path", ...]. They only read text, so they work on any framework whose
// routes are written down somewhere greppable. Bring your own when a project declares routes differently.

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD';

// 'GET /health' written as a string literal anywhere in the file.
export function literal(source) {
  const out = [];
  const re = new RegExp(`['"\`](${METHODS}) (/[^'"\`\\s]*)['"\`]`, 'g');
  for (const m of source.matchAll(re)) out.push(`${m[1]} ${m[2]}`);
  return out;
}

// app.get('/x', ...) / router.post('/x', ...) - Express, Fastify, Koa-router and friends.
export function expressCalls(source) {
  const out = [];
  const re = /\b(?:app|router|server|fastify|api)\.(get|post|put|patch|delete|head)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const m of source.matchAll(re)) out.push(`${m[1].toUpperCase()} ${m[2]}`);
  return out;
}

// { method: 'GET', pattern: /^\/sessions\/(\d+)$/ } - a hand-rolled router that matches regex literals.
// Each numeric capture becomes :n, so the key reads like a route.
export function methodPattern(source) {
  const out = [];
  const re = /method: '([A-Z]+)',\s*pattern: (\/(?:\\\/|[^/\n])+\/)/g;
  for (const m of source.matchAll(re)) {
    const path = m[2].slice(1, -1).replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\(\\d\+\)/g, ':n');
    out.push(`${m[1]} ${path}`);
  }
  return out;
}

export const extractors = { literal, expressCalls, methodPattern };
