# surfacemap

A living map of how a project's **surfaces** (CLI, MCP, HTTP, dashboard) connect. It is generated from the code and from the tables you already keep, so it cannot quietly go stale: `surfacemap check` fails the build when the map is out of date, and when what you declared and what the code has stop agreeing.

Status: **0.1 scaffold.** It was extracted from [Web-Scout](../Web-Scout), where the idea started. Not published yet.

## What you get

- `docs/surfacemap.html` - one self-contained page. Pick any node and the columns narrow to what it is wired to, two steps out, with a line for each link and a panel that says what it is.
- `docs/surfacemap.json` - the same graph, for other tools.
- **Findings** - a declared thing the code does not have (`declared-not-in-code`), a thing in the code nothing exposes (`in-code-not-declared`), a CLI command with no MCP twin and no reason (`cli-without-mcp`), a surface left out with no reason (`gap-without-reason`).
- With `clientCalls`: a dashboard panel that claims a route no client file calls (`declared-call-not-in-client`), and a client call no panel declares (`client-call-undeclared`). A call to a route the server does not have shows as `declared-not-in-code`.

## Quick start

```sh
npx surfacemap init      # writes surfacemap.config.mjs
npx surfacemap build     # writes docs/surfacemap.html and .json
npx surfacemap check     # CI: exit 1 when stale or when findings reach --fail-on
```

```js
// surfacemap.config.mjs
import { defineConfig } from 'surfacemap';
import { routes, capabilities, commands, extractors } from 'surfacemap/adapters';
import { CLI_SPEC } from './cli-spec.mjs';

export default defineConfig({
  project: 'my-project',
  purpose: 'What this map is for, in a sentence.',
  out: 'docs/surfacemap',
  failOn: ['error'],               // add 'warn' to make drift fail CI
  adapters: [
    routes({ files: ['src/routes-*.js'], extract: extractors.expressCalls }),
    commands({ rows: CLI_SPEC }),
    capabilities({ rows: [{ id: 'health', http: ['GET /health'], cli: ['status'], dashboard: null, dashboardWhy: 'no panel' }] }),
  ],
});
```

## How it works

An **adapter** reads one source of truth and writes nodes and edges into one graph:

| Adapter | Reads | Writes |
|---|---|---|
| `routes({ files, extract, normalize, internal })` | source files, with an extractor (`literal`, `expressCalls`, `methodPattern`, or your own `(text) => ['GET /x']`) | `http` nodes found in code |
| `clientCalls({ files, extract, normalize })` | client files (a dashboard, a front-end bundle) with `apiCalls`, `fetchCalls` or `axiosCalls` | one `client` node per file, `calls` links to routes |
| `commands({ rows, fields })` | a CLI spec: `{ cmd, mcp, mcpExempt, read }` | `cli` and `mcp` nodes, `mirrors` and `reads` links |
| `capabilities({ rows })` | a table: `{ id, http, cli, mcp, dashboard, <surface>Why }` | `capability` and `dashboard` nodes, `exposes` and `calls` links |

An adapter is `{ name, run({ graph, root }) }`. Write your own for anything greppable: a Postgres schema, an event bus, a queue.

After the adapters run, drift is computed. Only kinds that can be compared are checked, so you can adopt one adapter at a time and get no noise from the rest.

## Live mode

`surfacemap serve` shows the same page, rebuilt from the files on every load, and adds a **Go live** button. Switched on, each route node gets a dot (green answering, amber 4xx, red 5xx or no answer) and a count when the answer is a list (`/items` returning 3 entries shows 3). A capability shows the worst answer among its routes. The detail panel gives status, time, and the count's source.

```sh
npx surfacemap serve --target http://127.0.0.1:3000   # or set live.target in the config
```

```js
live: {
  target: 'http://127.0.0.1:3000',
  interval: 5,                    // seconds between checks while the button is on
  timeoutMs: 4000,                // per call; raise it for a route that does real work
  exclude: [/^GET /admin/],      // routes never to call; `include` narrows the other way
  headers: { authorization: 'Bearer ...' },
}
```

- Open the served page with `?live` to start probing straight away.
- Probing runs in the `serve` process, not the page, so there is no CORS problem and a hung stream cannot stall the page.
- Only `GET` is sent, only to routes with no path parameters. Everything else is listed in the panel as "not probed" with the reason. A `GET` that changes state in your service would still change it: put it in `exclude`.
- Each call has a 4 s timeout, event streams are not read, bodies stop at 512 KB.
- The server listens on 127.0.0.1 only. `surfacemap build` output never has the live switch, so the committed file stays deterministic and `check` is unaffected.
- Config changes need a restart; code files and declaration tables are re-read on each page load only if the adapters read them from disk (an imported table such as `CLI_SPEC` is cached by Node until restart).

### Try it without a service of your own

```sh
npm run demo
```

Starts a small fake shop (`examples/demo/service.mjs`) that misbehaves on purpose - `/orders` grows over time, `/reports` always returns 500, `/search` is slow, `/flaky` fails every third call, `/legacy` is declared but not served - and serves its map with live mode on. Open the printed address with `?live` and watch the dots.

Pointed at Web-Scout it also catches the case live mode exists for: the map is built from one checkout and the service on the port is an older copy, so routes the map lists answer 404.

## Why it does not go stale

The page has no hand-drawn parts. Every node and link comes from code or from a table the project already tests. The output is deterministic (sorted, no timestamps) and CRLF-insensitive, so `check` is a plain byte comparison against a fresh build.

## Try it on Web-Scout

```sh
node bin/surfacemap.mjs build --config examples/web-scout.config.mjs
```

That builds 371 nodes and 446 links (the dashboard file makes 62 distinct calls, all matching what `surfaces.mjs` declares) and reports 47 findings. They are real: 47 CLI commands (`dom *`, `idb *`, `net *`, `relay *`, ...) are in `cli-spec.mjs` but no row in `surfaces.mjs` claims them.

## Develop

```sh
npm test
```

## Next

- Transition tables for state machines (snooze, known-issue review), drawn from the same tested table the code uses.
- Test-linked nodes: each node points at the test that proves it.
