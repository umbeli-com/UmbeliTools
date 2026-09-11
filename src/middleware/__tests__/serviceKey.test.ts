/**
 * The service-key gate. Run with:
 *   npx tsx --test src/middleware/__tests__/serviceKey.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  createServiceKeyMiddleware,
  keyFingerprint,
  matchServiceKey,
  timingSafeEqualStr,
} from '../serviceKey.middleware';
import { parseServiceKeys, parsePort, validateEnv, loadEnv, EnvValidationError } from '../../config/env';

interface Captured {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
}

function fakeRes(): Response & { captured: Captured } {
  const captured: Captured = { statusCode: 200, body: undefined, headers: {} };
  const res = {
    captured,
    headersSent: false,
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return res;
    },
    removeHeader() {
      return res;
    },
    on() {
      return res;
    },
  };
  return res as unknown as Response & { captured: Captured };
}

function fakeReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    method: 'POST',
    url: '/api/tools/email/send',
    originalUrl: '/api/tools/email/send',
    socket: { remoteAddress: '10.0.0.7' },
  } as unknown as Request;
}

const silent = () => {};

// ---------------------------------------------------------------- comparison

test('timingSafeEqualStr matches identical keys', () => {
  assert.equal(timingSafeEqualStr('sk-abcdef123456', 'sk-abcdef123456'), true);
});

test('timingSafeEqualStr rejects a different key of the same length', () => {
  assert.equal(timingSafeEqualStr('sk-abcdef123456', 'sk-abcdef123457'), false);
});

test('timingSafeEqualStr does not throw on different lengths', () => {
  // crypto.timingSafeEqual raises RangeError on unequal buffers; the length
  // guard is what keeps a wrong-length key a 401 instead of a 500.
  assert.doesNotThrow(() => timingSafeEqualStr('short', 'a-much-longer-key'));
  assert.equal(timingSafeEqualStr('short', 'a-much-longer-key'), false);
});

test('timingSafeEqualStr guards on BYTE length, not string length', () => {
  // 'é' is one character but two UTF-8 bytes: a .length check would let this
  // pair through to timingSafeEqual and throw.
  assert.doesNotThrow(() => timingSafeEqualStr('é', 'a'));
  assert.equal(timingSafeEqualStr('é', 'a'), false);
});

test('timingSafeEqualStr rejects empty strings and non-strings', () => {
  assert.equal(timingSafeEqualStr('', ''), false);
  assert.equal(timingSafeEqualStr(undefined, 'key'), false);
  assert.equal(timingSafeEqualStr(['key'], 'key'), false);
  assert.equal(timingSafeEqualStr(null, null), false);
});

// -------------------------------------------------------------- multiple keys

test('parseServiceKeys reads a single unnamed key (legacy spelling)', () => {
  assert.deepEqual(parseServiceKeys('s3cr3t-value'), [{ name: 'default', key: 's3cr3t-value' }]);
});

test('parseServiceKeys reads named, comma-separated keys', () => {
  assert.deepEqual(parseServiceKeys(' webum:aaa , manager:bbb ,, dialum:ccc '), [
    { name: 'webum', key: 'aaa' },
    { name: 'manager', key: 'bbb' },
    { name: 'dialum', key: 'ccc' },
  ]);
});

test('parseServiceKeys keeps a colon that belongs to the key itself', () => {
  // "not a name" fails NAME_RE, so the whole entry stays the key.
  assert.deepEqual(parseServiceKeys('not a name:with-colon'), [
    { name: 'default', key: 'not a name:with-colon' },
  ]);
});

test('parseServiceKeys never lets two entries claim one identity', () => {
  const parsed = parseServiceKeys('webum:aaa,webum:bbb,plain1,plain2');
  assert.deepEqual(
    parsed.map((e) => e.name),
    ['webum', 'webum-2', 'default', 'default-2'],
  );
});

test('matchServiceKey returns the matching caller among several', () => {
  const entries = parseServiceKeys('webum:aaa,manager:bbb');
  assert.deepEqual(matchServiceKey('bbb', entries), { name: 'manager', key: 'bbb' });
  assert.equal(matchServiceKey('ccc', entries), null);
  assert.equal(matchServiceKey(null, entries), null);
  assert.equal(matchServiceKey('aaa', []), null);
});

test('keyFingerprint identifies a rejected key without revealing it', () => {
  const fp = keyFingerprint('super-secret');
  assert.equal(fp.length, 8);
  assert.ok(!'super-secret'.includes(fp));
  assert.equal(keyFingerprint(null), 'none');
  assert.equal(keyFingerprint('super-secret'), fp, 'must be stable');
});

// ---------------------------------------------------------------- middleware

test('middleware answers 500 CONFIG_ERROR when no key is configured', () => {
  const mw = createServiceKeyMiddleware({ entries: [], logger: silent });
  const res = fakeRes();
  let nexted = false;
  mw(fakeReq({ 'x-service-key': 'anything' }), res, () => {
    nexted = true;
  });

  assert.equal(nexted, false);
  assert.equal(res.captured.statusCode, 500);
  assert.equal(res.captured.body.ok, false);
  assert.equal(res.captured.body.error.code, 'CONFIG_ERROR');
});

test('an empty configured key can never be matched by an empty header', () => {
  const mw = createServiceKeyMiddleware({ entries: parseServiceKeys(''), logger: silent });
  const res = fakeRes();
  mw(fakeReq({ 'x-service-key': '' }), res, () => assert.fail('must not authorise'));
  assert.equal(res.captured.statusCode, 500);
});

test('middleware answers 401 UNAUTHORIZED on a wrong or missing key', () => {
  const mw = createServiceKeyMiddleware({
    entries: parseServiceKeys('webum:right-key-0123456789'),
    logger: silent,
  });

  const cases: Record<string, string>[] = [{}, { 'x-service-key': 'wrong' }, { 'x-service-key': '' }];
  for (const headers of cases) {
    const res = fakeRes();
    mw(fakeReq(headers), res, () => assert.fail('must not call next'));
    assert.equal(res.captured.statusCode, 401);
    assert.equal(res.captured.body.error.code, 'UNAUTHORIZED');
    assert.ok(!JSON.stringify(res.captured.body).includes('right-key'), 'must not echo the key');
  }
});

test('middleware attaches the caller identity and calls next', () => {
  const mw = createServiceKeyMiddleware({
    entries: parseServiceKeys('webum:aaa-0123456789,manager:bbb-0123456789'),
    logger: silent,
  });
  const req = fakeReq({ 'x-service-key': 'bbb-0123456789' });
  const res = fakeRes();
  let nexted = false;
  mw(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true);
  assert.equal(res.captured.body, undefined);
  assert.deepEqual(req.caller, { name: 'manager', via: 'x-service-key' });
});

test('a rejection is logged with the fingerprint and the ip, never the key', () => {
  const lines: string[] = [];
  const mw = createServiceKeyMiddleware({
    entries: parseServiceKeys('webum:right-key-0123456789'),
    logger: (line) => lines.push(line),
  });
  mw(fakeReq({ 'x-service-key': 'guessed-key' }), fakeRes(), () => assert.fail());

  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /401 POST \/api\/tools\/email\/send/);
  assert.match(lines[0]!, /ip=10\.0\.0\.7/);
  assert.ok(!lines[0]!.includes('guessed-key'));
  assert.ok(lines[0]!.includes(keyFingerprint('guessed-key')));
});

// ------------------------------------------------------------------- env boot

test('PORT=abc is rejected instead of binding a random port', () => {
  assert.deepEqual(parsePort('abc'), {
    port: 3002,
    error: 'PORT must be an integer between 1 and 65535 (got "abc")',
  });
  // parseInt('3002abc') silently returned 3002; Number() does not.
  assert.equal(parsePort('3002abc').error !== null, true);
  assert.deepEqual(parsePort('8080'), { port: 8080, error: null });
  assert.deepEqual(parsePort(undefined), { port: 3002, error: null });
  assert.equal(parsePort('0').error !== null, true);
  assert.equal(parsePort('70000').error !== null, true);
});

test('validateEnv throws instead of booting into permanent CONFIG_ERROR', () => {
  assert.throws(
    () => validateEnv(loadEnv({ UMBELIUM_SERVICE_KEY: '' })),
    (err: unknown) =>
      err instanceof EnvValidationError && /UMBELIUM_SERVICE_KEY is not set/.test(err.message),
  );
  assert.throws(() => validateEnv(loadEnv({ UMBELIUM_SERVICE_KEY: ' , , ' })), EnvValidationError);
  assert.throws(
    () => validateEnv(loadEnv({ UMBELIUM_SERVICE_KEY: 'a-real-service-key-0123456789abcd', PORT: 'abc' })),
    EnvValidationError,
  );
  assert.doesNotThrow(() =>
    validateEnv(loadEnv({ UMBELIUM_SERVICE_KEY: 'a-real-service-key-0123456789abcd', PORT: '3002' })),
  );
});
