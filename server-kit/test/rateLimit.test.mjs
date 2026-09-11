/**
 * Loaded with import on purpose: the other half of the dual-build proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import { rateLimit, clientIp } from '@umbeli-com/server-kit';

function fakeReq({ ip = '1.2.3.4', forwarded, method = 'GET', path = '/x' } = {}) {
  return {
    method,
    path,
    url: path,
    originalUrl: path,
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    socket: { remoteAddress: ip },
  };
}

function fakeRes() {
  const state = { code: 200, body: null, headers: {} };
  return {
    state,
    setHeader(k, v) { state.headers[k.toLowerCase()] = v; },
    status(c) { state.code = c; return this; },
    json(b) { state.body = b; return this; },
  };
}

/** Run one request through a limiter; returns { res, passed }. */
function hit(limiter, req = fakeReq()) {
  const res = fakeRes();
  let passed = false;
  limiter(req, res, () => { passed = true; });
  return { res, passed };
}

test('allows up to max, then answers 429 with Retry-After', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });

  assert.equal(hit(limiter).passed, true);
  assert.equal(hit(limiter).passed, true);

  const third = hit(limiter);
  assert.equal(third.passed, false);
  assert.equal(third.res.state.code, 429);
  assert.equal(third.res.state.body.success, false);
  assert.equal(third.res.state.body.error.code, 'RATE_LIMIT');

  const retryAfter = Number(third.res.state.headers['retry-after']);
  assert.ok(Number.isInteger(retryAfter), 'Retry-After must be an integer number of seconds');
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After out of range: ${retryAfter}`);
  assert.equal(third.res.state.headers['ratelimit-remaining'], '0');
});

test('Retry-After is never 0 (a 0 tells the client to retry immediately)', () => {
  const limiter = rateLimit({ windowMs: 30, max: 1 });
  hit(limiter);
  const blocked = hit(limiter);
  assert.equal(blocked.res.state.code, 429);
  assert.ok(Number(blocked.res.state.headers['retry-after']) >= 1);
});

test('the window really slides — the key is allowed again once it expires', async () => {
  const limiter = rateLimit({ windowMs: 60, max: 1 });
  assert.equal(hit(limiter).passed, true);
  assert.equal(hit(limiter).passed, false);
  await sleep(80);
  assert.equal(hit(limiter).passed, true, 'window expired but the hit was still counted');
});

test('keyFn separates buckets; each limiter owns its store', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1, keyFn: (req) => req.headers['x-tenant'] });
  const a = { headers: { 'x-tenant': 'alpha' }, socket: {} };
  const b = { headers: { 'x-tenant': 'beta' }, socket: {} };

  assert.equal(hit(limiter, a).passed, true);
  assert.equal(hit(limiter, a).passed, false);
  assert.equal(hit(limiter, b).passed, true, 'a second tenant must not inherit the first one\'s count');

  const other = rateLimit({ windowMs: 60_000, max: 1, keyFn: (req) => req.headers['x-tenant'] });
  assert.equal(hit(other, a).passed, true, 'a separate limiter must have a separate store');
});

test('skip() bypasses counting entirely', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1, skip: (req) => req.headers['x-service-key'] === 'k' });
  const service = { headers: { 'x-service-key': 'k' }, socket: { remoteAddress: '9.9.9.9' } };
  for (let i = 0; i < 5; i++) assert.equal(hit(limiter, service).passed, true);
  assert.equal(limiter.size(), 0);
});

test('the sweep frees expired keys — the store does not grow forever', async () => {
  const limiter = rateLimit({ windowMs: 40, max: 5, sweepEvery: 10, keyFn: (req) => req.headers['k'] });

  for (let i = 0; i < 9; i++) hit(limiter, { headers: { k: `key-${i}` }, socket: {} });
  assert.equal(limiter.size(), 9, 'each distinct key should hold an entry');

  await sleep(60); // every entry above is now outside the window

  // The 10th call trips the amortised sweep, which drops the 9 dead keys and
  // keeps only this one. Without a sweep the Map would sit at 10 forever.
  hit(limiter, { headers: { k: 'fresh' }, socket: {} });
  assert.equal(limiter.size(), 1, `store leaked: ${limiter.size()} keys retained`);
});

test('a blocked request does not extend its own ban (hits are not re-stamped)', async () => {
  // A limiter that re-stamps on rejection bans a hammering client FOREVER: each
  // refused request pushes the window forward. windowMs is wide enough that
  // every refused hit below lands inside it.
  const limiter = rateLimit({ windowMs: 200, max: 1 });
  hit(limiter);
  for (let i = 0; i < 4; i++) {
    await sleep(10);
    assert.equal(hit(limiter).passed, false, 'setup: these must all be refused');
  }
  await sleep(180); // now past 200ms since the ONE counted hit
  assert.equal(hit(limiter).passed, true, 'refused requests must not keep the window alive');
});

test('reset() clears every counter', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  hit(limiter);
  assert.equal(hit(limiter).passed, false);
  limiter.reset();
  assert.equal(limiter.size(), 0);
  assert.equal(hit(limiter).passed, true);
});

test('bad options fail loudly at construction, not on the first request', () => {
  assert.throws(() => rateLimit({ windowMs: 0, max: 5 }), /windowMs/);
  assert.throws(() => rateLimit({ windowMs: 1000, max: 0 }), /max/);
});

test('clientIp prefers the left-most x-forwarded-for entry', () => {
  assert.equal(clientIp(fakeReq({ forwarded: '203.0.113.7, 10.0.0.1', ip: '10.0.0.1' })), '203.0.113.7');
  assert.equal(clientIp(fakeReq({ forwarded: ['198.51.100.2, 10.0.0.1'] })), '198.51.100.2');
  assert.equal(clientIp(fakeReq({ ip: '10.0.0.9' })), '10.0.0.9');
  assert.equal(clientIp({ headers: {}, socket: {} }), 'unknown');
});
