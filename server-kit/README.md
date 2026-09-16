# @umbeli-com/server-kit

The Express plumbing that nine Umbeli backends each wrote for themselves.

Bearer auth against Supabase, the inter-service key, the `{ success, … }`
envelope, the CORS allowlist, a rate limiter and the path-traversal guard —
one implementation, **published as both CommonJS and ESM**.

```bash
npm install @umbeli-com/server-kit
```

```js
// CommonJS (UmbeliumManager, Socialum, Profilum, Monitorum)
const { supabaseBearerAuth, errorHandler } = require('@umbeli-com/server-kit');
```
```ts
// ESM (Noesium, Webum, Servum)
import { supabaseBearerAuth, errorHandler } from '@umbeli-com/server-kit';
```

---

## Why this exists

`@umbeli-com/tools` (the sibling SDK in `client/`) is **ESM-only**, which is why
four of the nine backends cannot use it: `require()` of an ESM-only package
throws `ERR_REQUIRE_ESM`, and those four are CommonJS. This package will not
repeat that. It ships two compiled copies and a conditional `exports` map, and
a test in `test/dual-package.test.cjs` fails the build if either half breaks.

## Packaging

| | |
|---|---|
| `require('@umbeli-com/server-kit')` | `dist/cjs/index.js` (`module: commonjs`) |
| `import '@umbeli-com/server-kit'` | `dist/esm/index.js` (`module: es2022`) |
| Types | per-condition: `dist/cjs/index.d.ts` / `dist/esm/index.d.ts` |

How it is built: **two `tsc` passes over one source tree** (`tsconfig.cjs.json`,
`tsconfig.esm.json`), then `scripts/fixup-dual-build.js` writes a one-line
`package.json` into each output — `{"type":"commonjs"}` and `{"type":"module"}`.

That marker file is what lets both builds keep a plain `.js` extension: the
package root declares no `"type"`, so Node would read every `.js` as CommonJS,
and `dist/esm` would break on its first `export`. The alternative — emitting
`.mjs`/`.cjs` — needs a rename pass, rewrites every relative import in the
output, and breaks declaration maps. The marker file needs neither.

Two rules keep the dual build honest, and both are enforced by tests:

- **Every relative import in `src/` ends in `.js`.** Real Node ESM has no
  extension resolution; the CJS build resolves `./errors.js` to the same emitted
  file, so one spelling serves both.
- **No top-level `import` of an optional peer.** `ws` and
  `@supabase/supabase-js` are loaded lazily (see `src/internal/lazy-require.ts`),
  because a static import is evaluated at module load in *both* formats and
  would crash a backend that installed neither.

### Peer dependencies

| Package | Required? | Needed for |
|---|---|---|
| `express` | yes (`^4.17` or `^5`) | everything |
| `@supabase/supabase-js` | optional | `createServiceRoleClient()` only |
| `ws` | optional | the Node-20 WebSocket polyfill |

Nothing here imports `@supabase/supabase-js` for types either — the client is
typed structurally (`SupabaseAuthCapableClient`), so a real `SupabaseClient`
satisfies it and a backend that only wants `rateLimit()` typechecks without
supabase installed.

---

## API

### `supabaseBearerAuth(client, options?)`

Verifies `Authorization: Bearer <jwt>` with `client.auth.getUser(token)` and
attaches `req.userId` + `req.user`.

```ts
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

app.use('/api/private', supabaseBearerAuth(supabase));            // 401 without a valid token
app.use('/api/public',  supabaseBearerAuth(supabase, { required: false })); // continues anonymous
```

| Option | Default | |
|---|---|---|
| `required` | `true` | `false` = soft mode: no token, or a bad one, continues with `req.userId` undefined |
| `mapUser(user, req)` | — | turn the Supabase user into the app's own user object (may be async — Profilum looks up a local `users` row here). Return `null` to reject the identity with 403 |
| `userProperty` | `'user'` | where the mapped user is attached |
| `allowQueryToken` | `false` | also accept `?token=` — for EventSource / download links that cannot set a header. **Query strings land in access logs**; turn it on per route, never globally |

Responses: **401** `UNAUTHORIZED` (missing / invalid / expired) — **503**
`AUTH_UNAVAILABLE` when `getUser()` *throws*, i.e. Supabase itself is down. An
outage and a bad token are different incidents and must not look alike in the
logs.

There is deliberately **no dev-user fallback**. Webum's `attachUser` has one
(gated on `NODE_ENV`), and it is exactly the sort of thing that must not be
shared: one forgotten guard would authenticate anonymous traffic as a real
account in every app at once.

### `createServiceRoleClient({ url, key, schema?, options? })`

```ts
const db = createServiceRoleClient<SupabaseClient>({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,   // or an sb_secret_… key
});
```

Sets `persistSession: false` + `autoRefreshToken: false` (a backend has no
storage to persist into, and the refresh timer holds the event loop open), and
**installs the `ws` WebSocket polyfill before `createClient` is even resolved**.

That polyfill is the point. `@supabase/supabase-js` needs a global `WebSocket`
at `createClient()` time; Node 20 has none; every container in the suite runs
`node:20-alpine` — so `createClient()` throws *at boot*, the API crash-loops,
and the deploy still reports success. Five backends carry their own copy of the
same six-line fix.

`ws` is an **optional** peer: when it is missing you get one warning line and
the process keeps running (a backend that never touches realtime does not need
it). `installWebSocketPolyfill()` is exported separately for apps that build
their own client, and returns `'native' | 'installed' | 'unavailable'`.

### `serviceKeyMiddleware(key, options?)` and `timingSafeEqualStr(a, b)`

```js
app.use('/api/internal', serviceKeyMiddleware(process.env.UMBELIUM_SERVICE_KEY));
```

Constant-time comparison of the `x-service-key` header. `crypto.timingSafeEqual`
**throws** on buffers of unequal length, so the length is checked first — and a
length mismatch is not a secret worth hiding. UmbeliTools, Noesium and Servum
still do `provided !== key` today, which leaks the key one byte at a time to
anyone who can measure the response.

- Unconfigured key → **500 `CONFIG_ERROR`**, never 401: a 401 would send whoever
  is on call hunting the caller instead of the deploy. It also means an empty
  `UMBELIUM_SERVICE_KEY` can never be matched by an empty header.
- `alsoAccept: [oldKey]` keeps a rotation window open.

### `authOrServiceKey(client, serviceKey, options?)`

Either identity. The key is checked first and short-circuits, so a machine call
never pays a round trip to Supabase Auth. Sets `req.isService = true`.

### `errorKit`

```js
const { AppError, NotFoundError, sendSuccess, sendError, errorHandler, notFoundHandler } =
  require('@umbeli-com/server-kit');

app.get('/sites/:id', async (req, res) => {
  const site = await store.get(req.params.id);
  if (!site) throw new NotFoundError('Site not found');
  sendSuccess(res, site);                       // { success: true, data: … }
});

app.use(notFoundHandler());                     // 404 for unmatched routes
app.use(errorHandler());                        // MUST be last
```

Classes: `AppError` (400/`BAD_REQUEST` … pass your own status + code),
`BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`,
`ConflictError`, `TooManyRequestsError`.

`errorHandler()` answers an `AppError` with its own status/code, reads
`err.status`/`err.statusCode` from third-party errors (body-parser's 413, for
one), and hides the message and stack of anything else when
`NODE_ENV === 'production'`. If headers are already sent it delegates to Express
rather than trying to write twice.

> **Envelope warning.** This package answers `{ success, data }` /
> `{ success, error: { message, code } }` — Profilum's shape, the one the newer
> frontends parse. The UmbeliTools *service* answers `{ ok, data }`. Argument
> order follows this repo: `sendError(res, status, code, message, details?)`.
> Do not mix the two envelopes inside one API surface.

### `createErrorKit({ format })` — the error shape is an argument

The envelope above is the **default** and does not move. But it is not what
every frontend in the suite reads, and that is what kept three backends off
this package:

| backend | its client reads | what the kit's envelope did |
|---|---|---|
| Webum | `apps/admin/src/lib/managerBilling.ts` — `body?.error \|\| body?.message` | `body.error` is a truthy **object** → the user is shown « [object Object] ». Webum took `bearerToken()` only. |
| Servum | `apps/web/src/lib/api.ts` — same, as a string | refused `errorKit`; now carries an `errorMessage()` whose only job is to un-tangle two shapes out of one API |
| Profilum | `utils/response.js` | already the envelope — this is where the shape came from |

So pass the shape. `errorFormats.flat` is `{ error: "message" }` — nothing else,
byte-identical to the hand-written `res.status(401).json({ error })` it replaces:

```js
const { createErrorKit, errorFormats } = require('@umbeli-com/server-kit');

const http = createErrorKit({ format: errorFormats.flat });

app.use('/api', http.rateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/private', http.supabaseBearerAuth(supabase));
app.use('/api/internal', http.serviceKeyMiddleware(ENV.SERVICE_KEY, {
  status: 403,                       // Servum answers 403, not the kit's 401
  message: 'Invalid service key',
  requireConfigured: false,          // an unset key rejects instead of 500
}));
app.use(http.notFoundHandler());
app.use(http.errorHandler());        // still last

// routes that write errors by hand get the shape too
http.sendError(res, 422, 'VALIDATION', 'Le slug est déjà pris');  // { error: "…" }
```

**Use the factory, not the per-middleware option.** Both exist — the factory is
built on the option, and a per-call `format` still wins for the one route that
must differ. But five things can answer an error (`supabaseBearerAuth`,
`serviceKeyMiddleware`, `rateLimit`, `notFoundHandler`, `errorHandler`), and
forgetting one does not fail a build, a typecheck or a test: it ships, and some
rare path answers in the other shape. That bug already happened once — it is why
Servum's `api.ts` has an `errorMessage()`.

A format is just `(payload) => body`, where `payload` is
`{ status, code, message, details? }` — `message` is already redacted and
production-safe when it arrives, so RFC 7807 or anything else is three lines. A
format that throws or returns `undefined` falls back to the envelope rather than
hanging the request: this runs inside the terminal handler, where nothing is
left to catch a throw.

Only **errors** are formattable. `ok()` / `sendSuccess()` are opt-in per call
site, so an app that never calls them is never affected; error bodies come out
of middleware the app does not write, which was the whole problem.

### `corsAllowlist(env?, options?)` / `corsMiddleware(...)`

Reads `FRONTEND_ORIGIN`, then `CORS_ORIGINS`, then `CORS_ORIGIN` — all three
spellings are in production, and all are comma-separated since the domain
migration, because prod and preprod are served side by side:

```
FRONTEND_ORIGIN=https://scrapium.ca,https://www.scrapium.ca,https://scrapium.umbeli.com
```

localhost / `127.0.0.1` / `[::1]` on any port is always allowed, so a dev front
on any Vite port works with no env file. A trailing slash is normalised away.
An **unset** env means "no cross-origin browser access", never allow-all.

```js
app.use(cors({ origin: corsAllowlist().origin, credentials: true }));  // with the `cors` package
app.use(corsMiddleware());                                            // or dependency-free
```

`corsMiddleware()` answers preflights itself (204), mirrors the origin back
(never `*`, which browsers refuse to combine with credentials) and sets
`Vary: Origin` so a shared cache cannot serve one origin's headers to another.

### `rateLimit({ windowMs, max, keyFn?, … })` and `clientIp(req)`

```js
app.post('/api/forms/:id', rateLimit({ windowMs: 60_000, max: 10 }), submit);
```

Dependency-free sliding window. Sets `Retry-After` (never 0) and `RateLimit-*`
headers, and answers `429 RATE_LIMIT` in the envelope above.

- Each limiter owns its store, so one route's traffic cannot exhaust another's.
- The expiry sweep is **amortised** (every `sweepEvery` calls, default 500): a
  key seen once is dropped instead of living forever in the Map. `handler.size()`
  exposes the store size so the leak is testable, `handler.reset()` clears it.
- A refused request is **not** re-stamped — otherwise a hammering client bans
  itself forever, since every rejection would push the window forward.
- `clientIp()` reads the left-most `x-forwarded-for` entry (nginx fronts every
  deployed env). It is spoofable by anyone who can reach the API directly: this
  is a throttle, not an authorisation check.

**Single process only.** Counters are in memory and reset on restart — which is
what every API in the suite runs today (one container per environment). Put a
shared store behind it before scaling an API horizontally.

### `resolveWithin(root, candidate)`

```js
const file = resolveWithin(store.getAssetsDir(siteId), req.params.filename);
if (!file) return sendError(res, 400, 'BAD_REQUEST', 'Invalid path');
```

Returns the absolute path inside `root`, or `null` if the candidate escapes.
Use it **everywhere a URL segment becomes a filesystem path**.

- Node does not normalise `req.url`, so `..` reaches `path.join` intact.
- Express *does* decode `req.params`, so `%2e%2e%2f` arrives as `../` — a guard
  that greps the raw URL for `..` misses it. This one percent-decodes (twice:
  nginx decodes once on deployed envs) before normalising, and refuses a
  malformed escape rather than guessing.
- A leading `/` is stripped, not resolved: `req.path` is always `/something`,
  and `path.resolve(root, '/etc/passwd')` would return `/etc/passwd`.
- Containment is tested against `root + path.sep`, so `/srv/sites/abc-evil` is
  not accepted as being inside `/srv/sites/abc`.
- A NUL byte is refused (it truncates the path inside libc).

Unlike the Webum original, an escape attempt returns `null` instead of being
silently rewritten into a path inside the root that then 404s — the caller
wants to answer 400 and log it. `resolveWithinOrThrow()` throws a 400 `AppError`
instead, and does not echo the offending path back to the caller.

---

## Development

```bash
npm run build      # two tsc passes + the type markers
npm test           # build, then node:test (39 assertions across 4 files)
npm run typecheck  # tsc --noEmit
```

The tests import the package **by name** (`@umbeli-com/server-kit`), so they go
through the real `exports` map — `test/*.test.cjs` via `require`,
`test/*.test.mjs` via `import`. A broken exports map fails the suite instead of
being discovered by whoever adopts it first.
