/**
 * Loaded with require() on purpose: this file is half of the dual-build proof.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { timingSafeEqualStr, hasValidServiceKey, serviceKeyMiddleware } = require('@umbeli-com/server-kit');

test('equal strings compare true', () => {
  assert.equal(timingSafeEqualStr('s3cret-key', 's3cret-key'), true);
});

test('different strings of the SAME length compare false', () => {
  assert.equal(timingSafeEqualStr('s3cret-key', 's3cret-keZ'), false);
});

test('unequal lengths return false instead of throwing', () => {
  // crypto.timingSafeEqual throws RangeError on unequal byte lengths — the
  // whole reason this wrapper exists. A throw here would be a 500 on every
  // wrong-length key, and an oracle for the real key's length.
  assert.doesNotThrow(() => timingSafeEqualStr('short', 'a-much-longer-key'));
  assert.equal(timingSafeEqualStr('short', 'a-much-longer-key'), false);
  assert.equal(timingSafeEqualStr('a-much-longer-key', 'short'), false);
});

test('multi-byte strings of equal LENGTH but unequal BYTE length do not throw', () => {
  // 'é' is 1 char but 2 bytes in utf8: the JS-length check alone would let
  // these through to timingSafeEqual and throw. The guard is on Buffer length.
  assert.doesNotThrow(() => timingSafeEqualStr('é', 'a'));
  assert.equal(timingSafeEqualStr('é', 'a'), false);
  assert.equal(timingSafeEqualStr('clé-🔑', 'clé-🔑'), true);
});

test('non-strings and empties never match', () => {
  assert.equal(timingSafeEqualStr(undefined, undefined), false);
  assert.equal(timingSafeEqualStr(null, null), false);
  assert.equal(timingSafeEqualStr('', ''), false);
  assert.equal(timingSafeEqualStr(['key'], 'key'), false);
  assert.equal(timingSafeEqualStr(Buffer.from('key'), 'key'), false);
});

test('hasValidServiceKey reads the header case-insensitively and honours rotation', () => {
  const req = { headers: { 'x-service-key': 'old-key' } };
  assert.equal(hasValidServiceKey(req, 'new-key'), false);
  assert.equal(hasValidServiceKey(req, 'new-key', { alsoAccept: ['old-key'] }), true);
  assert.equal(hasValidServiceKey({ headers: {} }, 'new-key'), false);
  // An unset server key must never be matched by an empty/absent header.
  assert.equal(hasValidServiceKey({ headers: { 'x-service-key': '' } }, ''), false);
});

test('serviceKeyMiddleware answers 500 when the key is not configured, 401 when wrong', () => {
  const res = () => {
    const out = { code: 0, body: null };
    return {
      out,
      status(c) { out.code = c; return this; },
      json(b) { out.body = b; return this; },
      setHeader() {},
    };
  };

  const unconfigured = res();
  serviceKeyMiddleware(undefined)({ headers: {} }, unconfigured, () => assert.fail('must not call next'));
  assert.equal(unconfigured.out.code, 500);
  assert.equal(unconfigured.out.body.error.code, 'CONFIG_ERROR');

  const wrong = res();
  serviceKeyMiddleware('right')({ headers: { 'x-service-key': 'wrong' } }, wrong, () => assert.fail('must not call next'));
  assert.equal(wrong.out.code, 401);
  assert.equal(wrong.out.body.success, false);

  let nexted = false;
  const req = { headers: { 'x-service-key': 'right' } };
  serviceKeyMiddleware('right')(req, res(), () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.isService, true);
});
