/**
 * The packaging contract itself: BOTH module systems must load this package
 * through its "exports" map, and both copies must behave identically.
 * @umbeli-com/tools (ESM-only) is unusable from the four CommonJS backends —
 * this test is what keeps server-kit from repeating that.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const cjs = require('@umbeli-com/server-kit');

test('require() reaches dist/cjs and exports everything', () => {
  const expected = [
    'supabaseBearerAuth', 'createServiceRoleClient', 'serviceKeyMiddleware',
    'authOrServiceKey', 'corsAllowlist', 'rateLimit', 'resolveWithin',
    'timingSafeEqualStr', 'installWebSocketPolyfill', 'errorHandler', 'notFoundHandler',
  ];
  for (const name of expected) {
    assert.equal(typeof cjs[name], 'function', `missing CJS export: ${name}`);
  }
  assert.equal(typeof cjs.errorKit, 'object');
  assert.equal(typeof cjs.errorKit.AppError, 'function');
});

test('import() reaches dist/esm and exports the same surface', async () => {
  const esm = await import('@umbeli-com/server-kit');
  const cjsNames = Object.keys(cjs).sort();
  const esmNames = Object.keys(esm).filter((k) => k !== 'default').sort();
  assert.deepEqual(esmNames, cjsNames, 'the two builds disagree on their exports');
});

test('each build carries its own package.json type marker', () => {
  const dist = path.join(__dirname, '..', 'dist');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'cjs', 'package.json'), 'utf8')).type, 'commonjs');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'esm', 'package.json'), 'utf8')).type, 'module');
});

test('the CJS build contains no ESM syntax and the ESM build no require()', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'dist', p), 'utf8');
  const cjsIndex = read('cjs/index.js');
  const esmIndex = read('esm/index.js');
  assert.ok(cjsIndex.includes('require('), 'dist/cjs/index.js should use require()');
  assert.ok(!/^import /m.test(cjsIndex), 'dist/cjs/index.js must not contain ESM import statements');
  assert.ok(/^export /m.test(esmIndex), 'dist/esm/index.js should use export statements');
  assert.ok(!/\brequire\(/.test(esmIndex), 'dist/esm/index.js must not call require()');
});

test('both builds ship type declarations next to their JS', () => {
  const dist = path.join(__dirname, '..', 'dist');
  for (const dir of ['cjs', 'esm']) {
    assert.ok(fs.existsSync(path.join(dist, dir, 'index.d.ts')), `missing ${dir}/index.d.ts`);
  }
});

test('errors thrown by one build are recognised by that build', () => {
  const err = new cjs.NotFoundError('nope');
  assert.ok(err instanceof cjs.AppError);
  assert.ok(cjs.isAppError(err));
  assert.equal(err.statusCode, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.name, 'NotFoundError');

  // The dual-package hazard: the same class from the OTHER build output fails
  // `instanceof`, and would otherwise reach errorHandler() as an unknown error
  // (500, message hidden in production). isAppError() also accepts the brand.
  const fromOtherCopy = Object.assign(new Error('thrown by the ESM copy'), {
    [Symbol.for('@umbeli-com/server-kit.AppError')]: true,
    statusCode: 409,
    code: 'CONFLICT',
  });
  assert.ok(!(fromOtherCopy instanceof cjs.AppError), 'setup: instanceof must fail across copies');
  assert.ok(cjs.isAppError(fromOtherCopy), 'an AppError from the other build must still be operational');
  assert.equal(cjs.isAppError(new Error('plain')), false);
  assert.equal(cjs.isAppError(null), false);
  assert.equal(cjs.isAppError({ statusCode: 500, code: 'X' }), false, 'an unbranded lookalike is not an AppError');
});

test('the envelope helpers produce the suite shape', () => {
  assert.deepEqual(cjs.ok({ id: 1 }), { success: true, data: { id: 1 } });
  assert.deepEqual(cjs.fail('boom', 'X_CODE'), { success: false, error: { message: 'boom', code: 'X_CODE' } });

  // errorHandler(), the four branches that decide what a caller is told.
  const mkRes = (headersSent = false) => ({
    code: 0,
    body: null,
    headersSent,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  });
  const req = { method: 'GET', originalUrl: '/x', url: '/x' };
  const handler = cjs.errorHandler({ logger: () => {}, exposeInternals: false });

  const operational = mkRes();
  handler(new cjs.ConflictError('already claimed'), req, operational, () => assert.fail('must not delegate'));
  assert.equal(operational.code, 409);
  assert.deepEqual(operational.body, { success: false, error: { message: 'already claimed', code: 'CONFLICT' } });

  // body-parser's 413 arrives as a plain Error carrying `status` + `type`.
  const tooBig = mkRes();
  handler(
    Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' }),
    req, tooBig, () => assert.fail('must not delegate'),
  );
  assert.equal(tooBig.code, 413);
  assert.equal(tooBig.body.error.code, 'ENTITY_TOO_LARGE');
  assert.equal(tooBig.body.error.message, 'request entity too large');

  // Anything non-operational keeps its guts (connection strings, credentials in
  // a driver message) to itself once internals are hidden.
  const boom = mkRes();
  handler(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'), req, boom, () => assert.fail('must not delegate'));
  assert.equal(boom.code, 500);
  assert.equal(boom.body.error.message, 'Internal server error');
  assert.equal(boom.body.error.details, undefined);

  // A bearer token passed as ?token= (EventSource, download links) must not be
  // copied into the 404 body or the log line — both read req.originalUrl.
  const notFound = mkRes();
  cjs.notFoundHandler()(
    { method: 'GET', originalUrl: '/api/stream?token=eyJhbGciOiJIUzI1NiJ9.secret&id=7', url: '/api/stream' },
    notFound,
  );
  assert.equal(notFound.code, 404);
  assert.ok(!notFound.body.error.message.includes('eyJhbGciOiJIUzI1NiJ9'), 'the JWT must not be echoed back');
  assert.ok(notFound.body.error.message.includes('token=REDACTED'));
  assert.ok(notFound.body.error.message.includes('id=7'), 'only the secret parameters are redacted');

  // Headers already flushed: only Express's default handler can close this
  // connection, so the error is delegated instead of written twice.
  const flushed = mkRes(true);
  let delegated = null;
  handler(new Error('stream died'), req, flushed, (e) => { delegated = e; });
  assert.ok(delegated instanceof Error, 'a post-headers error must reach Express');
  assert.equal(flushed.code, 0, 'nothing may be written after headersSent');
});

test('the ws polyfill degrades instead of crashing when ws is absent', () => {
  // Node 20 has no native WebSocket and `ws` is an OPTIONAL peer that is NOT
  // installed here — the whole point is that this returns rather than throws.
  cjs.resetWebSocketPolyfillCache();
  const result = cjs.installWebSocketPolyfill();
  assert.ok(['native', 'installed', 'unavailable'].includes(result), `unexpected: ${result}`);
  if (typeof globalThis.WebSocket === 'undefined') {
    assert.equal(result, 'unavailable');
  }
});

test('createServiceRoleClient validates its inputs before loading supabase-js', () => {
  assert.throws(() => cjs.createServiceRoleClient({ url: '', key: 'k' }), /url. is required/);
  assert.throws(() => cjs.createServiceRoleClient({ url: 'https://x.supabase.co', key: '' }), /key. is required/);
});

test('a missing @supabase/supabase-js names itself instead of failing obscurely', () => {
  // supabase-js is an optional peer and is not installed in this package.
  assert.throws(
    () => cjs.createServiceRoleClient({ url: 'https://x.supabase.co', key: 'sb_secret_x' }),
    /@supabase\/supabase-js/,
  );
});

test('corsAllowlist reads the suite env conventions and always allows localhost', () => {
  const list = cjs.corsAllowlist({
    FRONTEND_ORIGIN: 'https://scrapium.ca, https://www.scrapium.ca ,https://scrapium.umbeli.com/',
  });
  assert.equal(list.source, 'FRONTEND_ORIGIN');
  assert.deepEqual(list.origins, [
    'https://scrapium.ca',
    'https://www.scrapium.ca',
    'https://scrapium.umbeli.com',
  ]);
  assert.equal(list.isAllowed('https://scrapium.ca'), true);
  assert.equal(list.isAllowed('https://scrapium.umbeli.com/'), true, 'trailing slash must be normalised');
  assert.equal(list.isAllowed('http://localhost:5173'), true);
  assert.equal(list.isAllowed('http://127.0.0.1:4173'), true);
  assert.equal(list.isAllowed('https://evil.example'), false);
  assert.equal(list.isAllowed(undefined), true, 'a request with no Origin is not a browser CORS request');

  const fallback = cjs.corsAllowlist({ CORS_ORIGINS: 'https://monitorum.umbeli.com' });
  assert.equal(fallback.source, 'CORS_ORIGINS');
  const legacy = cjs.corsAllowlist({ CORS_ORIGIN: 'https://servum.umbeli.com' });
  assert.equal(legacy.source, 'CORS_ORIGIN');
  const empty = cjs.corsAllowlist({});
  assert.equal(empty.source, null);
  assert.equal(empty.isAllowed('https://anything.example'), false, 'an unset env must not mean allow-all');

  // corsMiddleware: Vary belongs on EVERY answer — a shared cache that stored
  // the header-less refusal would otherwise replay it to an allowed origin,
  // which then sees no CORS headers at all — and it must not clobber a Vary
  // another middleware already set.
  const mw = cjs.corsMiddleware({ FRONTEND_ORIGIN: 'https://scrapium.ca' });
  const mkRes = (vary) => {
    const headers = vary ? { vary } : {};
    return {
      headers,
      code: 0,
      ended: false,
      getHeader(k) { return headers[k.toLowerCase()]; },
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(c) { this.code = c; return this; },
      end() { this.ended = true; return this; },
    };
  };

  const denied = mkRes();
  let passedThrough = false;
  mw({ method: 'GET', headers: { origin: 'https://evil.example' } }, denied, () => { passedThrough = true; });
  assert.equal(passedThrough, true, 'a refused origin is blocked by the browser, not by a 4xx');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.equal(denied.headers.vary, 'Origin', 'Vary: Origin is required even on a refusal');

  const mirrored = mkRes('Accept-Encoding');
  mw({ method: 'GET', headers: { origin: 'https://scrapium.ca' } }, mirrored, () => {});
  assert.equal(mirrored.headers['access-control-allow-origin'], 'https://scrapium.ca');
  assert.equal(mirrored.headers['access-control-allow-credentials'], 'true');
  assert.equal(mirrored.headers.vary, 'Accept-Encoding, Origin', 'an existing Vary must survive');

  const preflight = mkRes();
  mw(
    { method: 'OPTIONS', headers: { origin: 'https://scrapium.ca' } },
    preflight,
    () => assert.fail('a preflight must be answered here, not routed'),
  );
  assert.equal(preflight.code, 204);
  assert.equal(preflight.ended, true);
  assert.ok(String(preflight.headers['access-control-allow-headers']).includes('x-service-key'));
});
