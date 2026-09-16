/**
 * The response shape is now an argument — this file is the proof of the two
 * halves of that claim:
 *
 *   1. THE DEFAULT DID NOT MOVE. Every middleware that can answer an error is
 *      called with no options at all and asserted against the exact envelope it
 *      shipped with. The kit is in production; this half is the one that must
 *      never go green by accident.
 *   2. AN APP CAN ASK FOR ITS OWN. The same middlewares, with the flat format,
 *      answer the byte-identical body the three refusing backends write by hand
 *      today — asserted against the real lines from their sources.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createErrorKit,
  errorFormats,
  envelopeErrorFormat,
  flatErrorFormat,
  respondError,
  errorHandler,
  notFoundHandler,
  notFoundHandler as nf,
  rateLimit,
  serviceKeyMiddleware,
  supabaseBearerAuth,
  authOrServiceKey,
  ConflictError,
  sendError,
  errorKit,
} from '@umbeli-com/server-kit';

// ── harness ─────────────────────────────────────────────────────────────

function mkRes() {
  return {
    code: 0,
    body: undefined,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function mkReq({ auth, serviceKey, method = 'GET', url = '/x' } = {}) {
  const headers = {};
  if (auth) headers.authorization = auth;
  if (serviceKey) headers['x-service-key'] = serviceKey;
  return { method, url, originalUrl: url, path: url, headers, query: {}, socket: {} };
}

/** A Supabase client whose getUser() answers however the test wants. */
const supabaseThatRejects = { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'bad jwt' } }) } };
const supabaseThatIsDown = { auth: { getUser: async () => { throw new Error('ECONNREFUSED'); } } };
const supabaseThatAccepts = { auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) } };

/**
 * Runs a middleware and resolves once it has answered or called next().
 *
 * The timeout is not decoration: a middleware that does NEITHER is the failure
 * this suite exists to catch (a guard that falls through the bottom of its own
 * async chain leaves the socket open in production). Without it the promise
 * simply never settles and `node --test` hangs with no message at all —
 * a green-looking run that never ends. `passed: 'NEVER_ANSWERED'` fails an
 * assertion instead.
 */
function run(mw, req = mkReq()) {
  const res = mkRes();
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const done = (passed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ res, passed });
    };
    timer = setTimeout(() => done('NEVER_ANSWERED'), 2000);
    timer.unref?.();
    const json = res.json.bind(res);
    res.json = (b) => { const r = json(b); done(false); return r; };
    mw(req, res, (err) => done(err ?? true));
  });
}

/** Silence the deliberate console.error of the fallback path. */
function muted(fn) {
  const real = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = real; }
}

// ── 1. THE DEFAULT DID NOT MOVE ─────────────────────────────────────────

test('default: supabaseBearerAuth still answers the kit envelope, unchanged', async () => {
  const noToken = await run(supabaseBearerAuth(supabaseThatAccepts));
  assert.equal(noToken.res.code, 401);
  assert.deepEqual(noToken.res.body, {
    success: false,
    error: { message: 'Missing bearer token', code: 'UNAUTHORIZED' },
  });

  const bad = await run(supabaseBearerAuth(supabaseThatRejects), mkReq({ auth: 'Bearer nope' }));
  assert.equal(bad.res.code, 401);
  assert.deepEqual(bad.res.body, {
    success: false,
    error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' },
  });

  const down = await muted(() => run(supabaseBearerAuth(supabaseThatIsDown), mkReq({ auth: 'Bearer x' })));
  assert.equal(down.res.code, 503);
  assert.deepEqual(down.res.body, {
    success: false,
    error: { message: 'Authentication backend unavailable', code: 'AUTH_UNAVAILABLE' },
  });

  // mapUser refusing the identity — the 403 branch.
  const refused = await run(
    supabaseBearerAuth(supabaseThatAccepts, { mapUser: () => null }),
    mkReq({ auth: 'Bearer good' }),
  );
  assert.equal(refused.res.code, 403);
  assert.deepEqual(refused.res.body, {
    success: false,
    error: { message: 'Account is not provisioned for this service', code: 'FORBIDDEN' },
  });
});

test('default: serviceKeyMiddleware still answers 401 / 500 in the envelope', async () => {
  const wrong = await run(serviceKeyMiddleware('right-key'), mkReq({ serviceKey: 'wrong-key' }));
  assert.equal(wrong.res.code, 401);
  assert.deepEqual(wrong.res.body, {
    success: false,
    error: { message: 'Invalid or missing service key', code: 'UNAUTHORIZED' },
  });

  const unconfigured = await run(serviceKeyMiddleware(undefined), mkReq({ serviceKey: 'anything' }));
  assert.equal(unconfigured.res.code, 500);
  assert.deepEqual(unconfigured.res.body, {
    success: false,
    error: { message: 'Service key is not configured on this server', code: 'CONFIG_ERROR' },
  });

  const good = await run(serviceKeyMiddleware('right-key'), mkReq({ serviceKey: 'right-key' }));
  assert.equal(good.passed, true);
  assert.equal(good.res.body, undefined, 'a valid key must not write a body');
});

test('default: errorHandler / notFoundHandler / rateLimit envelopes are untouched', () => {
  const handler = errorHandler({ logger: () => {}, exposeInternals: false });
  const res = mkRes();
  handler(new ConflictError('already claimed'), mkReq(), res, () => assert.fail('no delegation'));
  assert.equal(res.code, 409);
  assert.deepEqual(res.body, {
    success: false,
    error: { message: 'already claimed', code: 'CONFLICT' },
  });

  const nfRes = mkRes();
  notFoundHandler()(mkReq({ url: '/api/ghost' }), nfRes);
  assert.equal(nfRes.code, 404);
  assert.deepEqual(nfRes.body, {
    success: false,
    error: { message: 'Route not found: GET /api/ghost', code: 'NOT_FOUND' },
  });

  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const first = mkRes();
  limiter(mkReq(), first, () => {});
  const blocked = mkRes();
  limiter(mkReq(), blocked, () => assert.fail('second hit must be refused'));
  assert.equal(blocked.code, 429);
  assert.deepEqual(blocked.body, {
    success: false,
    error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT' },
  });
  // The 429 headers are set BEFORE the body goes through the format hook; a
  // format that swallowed the response would take them with it.
  assert.deepEqual(
    {
      retry: blocked.headers['retry-after'],
      limit: blocked.headers['ratelimit-limit'],
      remaining: blocked.headers['ratelimit-remaining'],
    },
    { retry: '60', limit: '1', remaining: '0' },
  );
});

test('default: the free sendError() and the errorKit bundle are byte-identical to before', () => {
  const res = mkRes();
  sendError(res, 418, 'TEAPOT', 'short and stout', { spout: true });
  assert.equal(res.code, 418);
  assert.deepEqual(res.body, {
    success: false,
    error: { message: 'short and stout', code: 'TEAPOT', details: { spout: true } },
  });
  assert.equal(errorKit.sendError, sendError, 'the bundle must still hold the same function');
  assert.equal(errorKit.errorFormats.envelope, envelopeErrorFormat);
});

// ── 2. AN APP CAN ASK FOR ITS OWN SHAPE ─────────────────────────────────

test('flat format is exactly { error: "message" } — no code, no details, no stack', () => {
  assert.deepEqual(flatErrorFormat({ status: 401, code: 'UNAUTHORIZED', message: 'nope', details: { stack: 'x' } }), {
    error: 'nope',
  });
  assert.deepEqual(Object.keys(flatErrorFormat({ status: 500, code: 'X', message: 'm' })), ['error']);
  assert.equal(errorFormats.flat, flatErrorFormat);
  assert.equal(errorFormats.envelope, envelopeErrorFormat);
});

/**
 * How Webum's admin and Servum's web client BOTH read an error body:
 *   apps/admin/src/lib/managerBilling.ts — `body?.error || body?.message || …`
 * Not a paraphrase — this is the expression, so the assertions below exercise the
 * real rendering rather than a restatement of it.
 */
const asLegacyClientReadsIt = (body) =>
  String(body?.error || body?.message || 'Request failed');

test('the [object Object] bug is REAL on the envelope and GONE on the flat shape', async () => {
  // Half one: reproduce the bug. If this stops being true, the flat format has
  // no reason to exist and the rest of this file is theatre.
  const enveloped = await run(supabaseBearerAuth(supabaseThatRejects));
  assert.deepEqual(enveloped.res.body, {
    success: false,
    error: { message: 'Missing bearer token', code: 'UNAUTHORIZED' },
  });
  assert.equal(
    asLegacyClientReadsIt(enveloped.res.body),
    '[object Object]',
    'the envelope really does render as [object Object] in these two clients',
  );

  // Half two: the flat shape renders the message.
  const flat = await run(supabaseBearerAuth(supabaseThatRejects, { format: errorFormats.flat }));
  assert.deepEqual(flat.res.body, { error: 'Missing bearer token' });
  assert.equal(asLegacyClientReadsIt(flat.res.body), 'Missing bearer token');
});

test('Servum + Webum: the flat shape alone is NOT their body — the text needs `messages`', async () => {
  // The shape matches; the TEXT does not, and it differs per app and per
  // branch. Asserted against the real lines:
  //   Servum apps/api/src/middlewares/auth.ts:42  "Missing authorization header"
  //   Webum  apps/api/src/middleware/auth.ts:100  "Authorization header missing"
  //   Webum  apps/api/src/middleware/auth.ts:106  "Bearer token missing"
  //   both                                        "Invalid or expired token"
  const shapeOnly = await run(supabaseBearerAuth(supabaseThatRejects, { format: errorFormats.flat }));
  assert.notDeepEqual(
    shapeOnly.res.body,
    { error: 'Missing authorization header' },
    'the kit default is NOT Servum\'s text — this is why `messages` exists',
  );

  // Servum, byte for byte.
  const servum = supabaseBearerAuth(supabaseThatRejects, {
    format: errorFormats.flat,
    allowQueryToken: true, // requireAuth accepts ?token=
    messages: { missingToken: 'Missing authorization header' },
  });
  const servumMissing = await run(servum);
  assert.equal(servumMissing.res.code, 401);
  assert.deepEqual(servumMissing.res.body, { error: 'Missing authorization header' });

  const servumInvalid = await run(servum, mkReq({ auth: 'Bearer expired' }));
  assert.equal(servumInvalid.res.code, 401);
  assert.deepEqual(servumInvalid.res.body, { error: 'Invalid or expired token' });

  // Webum, byte for byte — including its TWO texts for the kit's single
  // no-token branch, which is why the override may be a function of the req.
  const webum = supabaseBearerAuth(supabaseThatRejects, {
    format: errorFormats.flat,
    messages: {
      missingToken: (req) =>
        req.headers.authorization ? 'Bearer token missing' : 'Authorization header missing',
    },
  });
  const noHeader = await run(webum);
  assert.deepEqual(noHeader.res.body, { error: 'Authorization header missing' });

  const unparsable = await run(webum, mkReq({ auth: 'Basic aGk6dGhlcmU=' }));
  assert.equal(unparsable.res.code, 401);
  assert.deepEqual(unparsable.res.body, { error: 'Bearer token missing' });

  // Both render as a string in the clients that refused this middleware.
  assert.equal(asLegacyClientReadsIt(noHeader.res.body), 'Authorization header missing');
});

test('a `messages` override that throws or returns nothing keeps the default — a guard always answers', async () => {
  const mw = supabaseBearerAuth(supabaseThatRejects, {
    format: errorFormats.flat,
    messages: { missingToken: () => { throw new Error('broken message'); } },
  });
  const thrown = await muted(() => run(mw));
  assert.equal(thrown.res.code, 401, 'the request must still be REFUSED, not left hanging');
  assert.deepEqual(thrown.res.body, { error: 'Missing bearer token' });

  const empty = await run(
    supabaseBearerAuth(supabaseThatRejects, { messages: { missingToken: () => '' } }),
  );
  assert.deepEqual(empty.res.body, {
    success: false,
    error: { message: 'Missing bearer token', code: 'UNAUTHORIZED' },
  });
});

test('default: `messages` unset changes nothing on any of the four branches', async () => {
  const texts = [];
  const spy = (p) => { texts.push([p.status, p.message]); return { error: p.message }; };
  await run(supabaseBearerAuth(supabaseThatAccepts, { format: spy }));
  await run(supabaseBearerAuth(supabaseThatRejects, { format: spy }), mkReq({ auth: 'Bearer x' }));
  await muted(() => run(supabaseBearerAuth(supabaseThatIsDown, { format: spy }), mkReq({ auth: 'Bearer x' })));
  await run(supabaseBearerAuth(supabaseThatAccepts, { format: spy, mapUser: () => null }), mkReq({ auth: 'Bearer x' }));
  assert.deepEqual(texts, [
    [401, 'Missing bearer token'],
    [401, 'Invalid or expired token'],
    [503, 'Authentication backend unavailable'],
    [403, 'Account is not provisioned for this service'],
  ]);
});

test('Servum: serviceKeyMiddleware can answer 403 + { error } like requireServiceKey does today', async () => {
  // apps/api/src/middlewares/auth.ts:
  //   res.status(403).json({ error: "Invalid service key" });
  const mw = serviceKeyMiddleware('the-key', {
    format: errorFormats.flat,
    status: 403,
    message: 'Invalid service key',
    requireConfigured: false,
  });

  const wrong = await run(mw, mkReq({ serviceKey: 'nope' }));
  assert.equal(wrong.res.code, 403);
  assert.deepEqual(wrong.res.body, { error: 'Invalid service key' });

  const none = await run(mw, mkReq());
  assert.equal(none.res.code, 403);
  assert.deepEqual(none.res.body, { error: 'Invalid service key' });

  // requireConfigured:false — an unset key rejects like a wrong one (Servum's
  // behaviour today) instead of the kit's 500 CONFIG_ERROR.
  const unset = await run(
    serviceKeyMiddleware(undefined, { format: errorFormats.flat, status: 403, message: 'Invalid service key', requireConfigured: false }),
    mkReq({ serviceKey: 'anything' }),
  );
  assert.equal(unset.res.code, 403);
  assert.deepEqual(unset.res.body, { error: 'Invalid service key' });

  // …and the default still shouts about the misconfiguration.
  const shouts = await run(serviceKeyMiddleware(undefined, { format: errorFormats.flat }), mkReq());
  assert.equal(shouts.res.code, 500);
  assert.deepEqual(shouts.res.body, { error: 'Service key is not configured on this server' });
});

test('Servum: errorHandler, notFoundHandler and rateLimit in flat form', () => {
  const handler = errorHandler({ logger: () => {}, exposeInternals: false, format: errorFormats.flat });

  const operational = mkRes();
  handler(new ConflictError('already claimed'), mkReq(), operational, () => assert.fail('no delegation'));
  assert.equal(operational.code, 409);
  assert.deepEqual(operational.body, { error: 'already claimed' });

  // A non-operational error still hides its guts — the format sees the message
  // AFTER redaction, never the raw one.
  const boom = mkRes();
  handler(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'), mkReq(), boom, () => assert.fail('no delegation'));
  assert.equal(boom.code, 500);
  assert.deepEqual(boom.body, { error: 'Internal server error' });

  // …and in dev, where exposeInternals is on, the flat shape still refuses to
  // carry the stack: a client reading body.error gets a string, full stop.
  const dev = errorHandler({ logger: () => {}, exposeInternals: true, format: errorFormats.flat });
  const devRes = mkRes();
  dev(new Error('kaboom'), mkReq(), devRes, () => assert.fail('no delegation'));
  assert.deepEqual(devRes.body, { error: 'kaboom' });

  const notFound = mkRes();
  nf({ format: errorFormats.flat })(mkReq({ url: '/api/ghost' }), notFound);
  assert.equal(notFound.code, 404);
  assert.deepEqual(notFound.body, { error: 'Route not found: GET /api/ghost' });

  const limiter = rateLimit({ windowMs: 60_000, max: 1, format: errorFormats.flat, message: 'Trop de requetes' });
  limiter(mkReq(), mkRes(), () => {});
  const blocked = mkRes();
  limiter(mkReq(), blocked, () => assert.fail('must be refused'));
  assert.equal(blocked.code, 429);
  assert.deepEqual(blocked.body, { error: 'Trop de requetes' });
});

test('the 404 message stays redacted whatever the format — a ?token= must never be echoed', () => {
  const res = mkRes();
  const seen = [];
  nf({ format: (p) => { seen.push(p); return { error: p.message }; } })(
    mkReq({ url: '/api/stream?token=eyJhbGciOiJIUzI1NiJ9.secret&id=7' }),
    res,
  );
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].message.includes('eyJhbGciOiJIUzI1NiJ9'), 'the JWT reached the formatter');
  assert.ok(seen[0].message.includes('token=REDACTED'));
  assert.ok(seen[0].message.includes('id=7'), 'only the secret parameters are redacted');
  assert.deepEqual(res.body, { error: seen[0].message });
});

test('a custom format sees the whole payload: status, code, message, details', () => {
  const seen = [];
  const rfc7807 = (p) => {
    seen.push(p);
    return { type: `https://umbeli.com/errors/${p.code.toLowerCase()}`, title: p.message, status: p.status };
  };
  const res = mkRes();
  errorHandler({ logger: () => {}, exposeInternals: false, format: rfc7807 })(
    new ConflictError('already claimed', { siteId: 'abc' }),
    mkReq(),
    res,
    () => assert.fail('no delegation'),
  );
  assert.deepEqual(seen[0], {
    status: 409,
    code: 'CONFLICT',
    message: 'already claimed',
    details: { siteId: 'abc' },
  });
  assert.equal(res.code, 409);
  assert.deepEqual(res.body, {
    type: 'https://umbeli.com/errors/conflict',
    title: 'already claimed',
    status: 409,
  });
});

test('a format that throws or returns nothing falls back to the envelope instead of hanging the request', () => {
  // This runs inside the TERMINAL error handler: there is no next handler left,
  // so a throw here would leave the socket open until the client gives up.
  const thrower = mkRes();
  muted(() => respondError(thrower, { status: 400, code: 'BAD_REQUEST', message: 'bad input' }, () => {
    throw new Error('formatter is broken');
  }));
  assert.equal(thrower.code, 400, 'the status must survive a broken formatter');
  assert.deepEqual(thrower.body, {
    success: false,
    error: { message: 'bad input', code: 'BAD_REQUEST' },
  });

  const empty = mkRes();
  muted(() => respondError(empty, { status: 500, code: 'INTERNAL_ERROR', message: 'boom' }, () => undefined));
  assert.deepEqual(empty.body, { success: false, error: { message: 'boom', code: 'INTERNAL_ERROR' } });

  const nulled = mkRes();
  muted(() => respondError(nulled, { status: 403, code: 'FORBIDDEN', message: 'nope' }, () => null));
  assert.equal(nulled.code, 403);
  assert.deepEqual(
    nulled.body,
    { success: false, error: { message: 'nope', code: 'FORBIDDEN' } },
    'res.json(null) would answer the four bytes `null` and break every client reading body.error',
  );

  // …and through a real middleware, not just the helper.
  const viaHandler = mkRes();
  muted(() => errorHandler({ logger: () => {}, format: () => { throw new Error('nope'); } })(
    new ConflictError('x'), mkReq(), viaHandler, () => assert.fail('no delegation'),
  ));
  assert.equal(viaHandler.code, 409);
  assert.equal(viaHandler.body.success, false);
});

// ── 3. THE FACTORY ──────────────────────────────────────────────────────

test('createErrorKit declares the shape once and every middleware it builds obeys', async () => {
  const http = createErrorKit({ format: errorFormats.flat, logger: () => {}, exposeInternals: false });
  assert.equal(http.format, flatErrorFormat);

  const auth = await run(http.supabaseBearerAuth(supabaseThatRejects));
  assert.deepEqual(auth.res.body, { error: 'Missing bearer token' });

  const svc = await run(http.serviceKeyMiddleware('k', { status: 403, message: 'Invalid service key' }), mkReq({ serviceKey: 'x' }));
  assert.equal(svc.res.code, 403);
  assert.deepEqual(svc.res.body, { error: 'Invalid service key' });

  const limiter = http.rateLimit({ windowMs: 60_000, max: 1 });
  limiter(mkReq(), mkRes(), () => {});
  const blocked = mkRes();
  limiter(mkReq(), blocked, () => assert.fail('must be refused'));
  assert.deepEqual(blocked.body, { error: 'Too many requests, please try again later.' });

  const notFound = mkRes();
  http.notFoundHandler()(mkReq({ url: '/nope' }), notFound);
  assert.deepEqual(notFound.body, { error: 'Route not found: GET /nope' });

  const boom = mkRes();
  http.errorHandler()(new ConflictError('dup'), mkReq(), boom, () => assert.fail('no delegation'));
  assert.equal(boom.code, 409);
  assert.deepEqual(boom.body, { error: 'dup' });

  // authOrServiceKey inherits it on BOTH paths.
  const either = http.authOrServiceKey(supabaseThatRejects, 'k');
  const asService = await run(either, mkReq({ serviceKey: 'k' }));
  assert.equal(asService.passed, true, 'a valid service key short-circuits');
  const asNobody = await run(either, mkReq());
  assert.deepEqual(asNobody.res.body, { error: 'Missing bearer token' });

  // Routes writing errors by hand get the shape too.
  const manual = mkRes();
  http.sendError(manual, 422, 'VALIDATION', 'Le slug est deja pris');
  assert.equal(manual.code, 422);
  assert.deepEqual(manual.body, { error: 'Le slug est deja pris' });
  const payload = mkRes();
  http.respondError(payload, { status: 404, code: 'NOT_FOUND', message: 'Site introuvable' });
  assert.deepEqual(payload.body, { error: 'Site introuvable' });
});

test('createErrorKit with no format is the envelope — an existing adopter sees nothing change', async () => {
  const http = createErrorKit();
  assert.equal(http.format, envelopeErrorFormat);

  const auth = await run(http.supabaseBearerAuth(supabaseThatRejects));
  assert.deepEqual(auth.res.body, { success: false, error: { message: 'Missing bearer token', code: 'UNAUTHORIZED' } });

  const res = mkRes();
  http.errorHandler({ logger: () => {} })(new ConflictError('dup'), mkReq(), res, () => assert.fail('no delegation'));
  assert.deepEqual(res.body, { success: false, error: { message: 'dup', code: 'CONFLICT' } });
});

test('a per-call format overrides the kit — one route may answer differently', async () => {
  const http = createErrorKit({ format: errorFormats.flat });
  const odd = await run(http.supabaseBearerAuth(supabaseThatRejects, { format: errorFormats.envelope }));
  assert.deepEqual(odd.res.body, { success: false, error: { message: 'Missing bearer token', code: 'UNAUTHORIZED' } });

  const usual = await run(http.supabaseBearerAuth(supabaseThatRejects));
  assert.deepEqual(usual.res.body, { error: 'Missing bearer token' });
});

test('createErrorKit reshapes errors only — success bodies are the same functions', () => {
  const http = createErrorKit({ format: errorFormats.flat });
  assert.deepEqual(http.ok({ id: 1 }), { success: true, data: { id: 1 } });
  assert.deepEqual(http.fail('boom', 'X'), { success: false, error: { message: 'boom', code: 'X' } });
  const res = mkRes();
  http.sendSuccess(res, { id: 7 });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { success: true, data: { id: 7 } });
});

test('kit options do not leak into the auth logic they travel with', async () => {
  // `format`, `status`, `message` and `requireConfigured` ride in the same bag
  // as `header`/`alsoAccept`; a valid key must still pass, and a mapped user
  // must still land on req.
  const http = createErrorKit({ format: errorFormats.flat });
  const req = mkReq({ auth: 'Bearer good' });
  const mapped = await run(
    http.supabaseBearerAuth(supabaseThatAccepts, { mapUser: (u) => ({ id: u.id, name: 'Brice' }), userProperty: 'appUser' }),
    req,
  );
  assert.equal(mapped.passed, true);
  assert.equal(req.userId, 'u-1');
  assert.deepEqual(req.appUser, { id: 'u-1', name: 'Brice' });

  const rotated = await run(
    http.serviceKeyMiddleware('current', { alsoAccept: ['previous'], status: 403 }),
    mkReq({ serviceKey: 'previous' }),
  );
  assert.equal(rotated.passed, true, 'a rotation key must still be accepted');
});


// ── 4. THE THINGS A WRONG ANSWER CANNOT BE ──────────────────────────────

test('an error never answers 2xx, whatever status it was handed', () => {
  // `new AppError(msg, code, 200)` — or an app calling respondError with a
  // computed status — used to answer 200 with an error body: the client's
  // `res.ok` is true and the failure is swallowed whole.
  for (const bogus of [200, 204, 302, 0, -1, 99, 600, NaN, undefined, null, '500', 1.5]) {
    const res = mkRes();
    respondError(res, { status: bogus, code: 'X', message: 'm' });
    assert.equal(res.code, 500, `status ${String(bogus)} must not be answered as-is`);
    assert.deepEqual(res.body, { success: false, error: { message: 'm', code: 'X' } });
  }
  // Real error statuses are passed through untouched.
  for (const real of [400, 401, 403, 404, 409, 418, 429, 500, 503, 599]) {
    const res = mkRes();
    respondError(res, { status: real, code: 'X', message: 'm' });
    assert.equal(res.code, real);
  }
});

test('Express arity is intact — an error handler is detected by (err,req,res,next) alone', () => {
  // A handler that loses its 4th parameter is not an error handler to Express:
  // it is silently never called, and every 500 falls through to the default
  // HTML page. Nothing in a build or a typecheck sees that.
  assert.equal(errorHandler().length, 4, 'errorHandler must take exactly 4 params');
  assert.equal(createErrorKit().errorHandler().length, 4);
  assert.equal(createErrorKit({ format: errorFormats.flat }).errorHandler().length, 4);

  // …and the converse: a normal middleware with 4 params would be mounted as
  // an ERROR handler and never see a normal request.
  const http = createErrorKit({ format: errorFormats.flat });
  for (const [name, handler] of [
    ['notFoundHandler', notFoundHandler()],
    ['kit.notFoundHandler', http.notFoundHandler()],
    ['rateLimit', rateLimit({ windowMs: 1000, max: 1 })],
    ['kit.rateLimit', http.rateLimit({ windowMs: 1000, max: 1 })],
    ['serviceKeyMiddleware', serviceKeyMiddleware('k')],
    ['kit.serviceKeyMiddleware', http.serviceKeyMiddleware('k')],
    ['supabaseBearerAuth', supabaseBearerAuth(supabaseThatAccepts)],
    ['kit.supabaseBearerAuth', http.supabaseBearerAuth(supabaseThatAccepts)],
    ['authOrServiceKey', authOrServiceKey(supabaseThatAccepts, 'k')],
    ['kit.authOrServiceKey', http.authOrServiceKey(supabaseThatAccepts, 'k')],
  ]) {
    assert.ok(handler.length < 4, `${name} must NOT look like an error handler (arity ${handler.length})`);
  }
});

test('the factory returns the real limiter, not a wrapper that lost reset()/size()', () => {
  const limiter = createErrorKit({ format: errorFormats.flat }).rateLimit({ windowMs: 60_000, max: 5 });
  assert.equal(typeof limiter.reset, 'function');
  assert.equal(typeof limiter.size, 'function');
  limiter(mkReq(), mkRes(), () => {});
  assert.equal(limiter.size(), 1);
  limiter.reset();
  assert.equal(limiter.size(), 0);
});

test('an option bag carrying `format: undefined` keeps the kit shape instead of reverting', async () => {
  // `http.rateLimit({ ...cfg })` where cfg has no format produces exactly this.
  // A naive `{ format, ...o }` spread would put undefined back and the
  // middleware would fall to its own envelope default — one middleware in the
  // other shape, which is the bug the factory is sold as preventing.
  const http = createErrorKit({ format: errorFormats.flat, logger: () => {}, exposeInternals: false });

  const auth = await run(http.supabaseBearerAuth(supabaseThatRejects, { format: undefined, required: true }));
  assert.deepEqual(auth.res.body, { error: 'Missing bearer token' });

  const svc = await run(http.serviceKeyMiddleware('k', { format: undefined }), mkReq({ serviceKey: 'x' }));
  assert.deepEqual(svc.res.body, { error: 'Invalid or missing service key' });

  const limiter = http.rateLimit({ windowMs: 60_000, max: 1, format: undefined });
  limiter(mkReq(), mkRes(), () => {});
  const blocked = mkRes();
  limiter(mkReq(), blocked, () => assert.fail('must be refused'));
  assert.deepEqual(blocked.body, { error: 'Too many requests, please try again later.' });

  const nfRes = mkRes();
  http.notFoundHandler({ format: undefined })(mkReq({ url: '/nope' }), nfRes);
  assert.deepEqual(nfRes.body, { error: 'Route not found: GET /nope' });

  // Same for the non-format defaults: an undefined `exposeInternals` in the
  // per-call bag must not re-open the stack in a kit that closed it.
  const leaky = mkRes();
  http.errorHandler({ exposeInternals: undefined, format: errorFormats.envelope })(
    new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    mkReq(),
    leaky,
    () => assert.fail('no delegation'),
  );
  assert.equal(leaky.code, 500);
  assert.deepEqual(leaky.body, {
    success: false,
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
  assert.ok(!JSON.stringify(leaky.body).includes('hunter2'), 'the internal error leaked');
  assert.ok(!JSON.stringify(leaky.body).includes('stack'), 'the stack leaked');
});
