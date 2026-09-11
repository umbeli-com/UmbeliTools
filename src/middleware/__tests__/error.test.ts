/**
 * The 404 + error middleware. Run with:
 *   npx tsx --test src/middleware/__tests__/error.test.ts
 *
 * The second half boots a real Express app on an ephemeral port and calls it
 * over HTTP, because the three failures this middleware exists for — an unknown
 * route, a body `express.json()` refuses, and a throw outside a route's
 * try/catch — are all produced by Express itself and cannot be faked
 * convincingly with a stub request.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { classifyError, errorHandler, notFoundHandler } from '../error.middleware';
import { createServiceKeyMiddleware } from '../serviceKey.middleware';
import { AdapterError, ToolError } from '../../lib/errors';
import { parseServiceKeys } from '../../config/env';

const KEY = 'test-service-key-0123456789abcdef';

// ------------------------------------------------------------ classification

test('a ToolError keeps its code and gets the status its code maps to', () => {
  assert.deepEqual(classifyError(new ToolError('MISSING_FIELDS', 'query is required'), true), {
    status: 400,
    code: 'MISSING_FIELDS',
    message: 'query is required',
    details: undefined,
    serverFault: false,
  });

  const withDetails = classifyError(
    new ToolError('INVALID_FIELD', 'messages[0]: bad block', { index: 0 }),
    true,
  );
  assert.equal(withDetails.status, 400);
  assert.deepEqual(withDetails.details, { index: 0 });
});

test('an unknown ToolError code falls back to 400, not 500', () => {
  assert.equal(classifyError(new ToolError('SOMETHING_NEW', 'nope'), true).status, 400);
});

test('an AdapterError becomes 502 PROVIDER_ERROR and never leaks the upstream body', () => {
  const err = new AdapterError('Mailjet rejected the message', {
    status: 401,
    body: { Authorization: 'Bearer super-secret' },
  });
  const classified = classifyError(err, true);

  assert.equal(classified.status, 502);
  assert.equal(classified.code, 'PROVIDER_ERROR');
  assert.deepEqual(classified.details, { providerStatus: 401 });
  assert.ok(!JSON.stringify(classified).includes('super-secret'));
});

test('a body-parser failure becomes 400 INVALID_JSON', () => {
  const err = Object.assign(new SyntaxError('Unexpected token } in JSON at position 4'), {
    type: 'entity.parse.failed',
    status: 400,
  });
  const classified = classifyError(err, false);
  assert.equal(classified.status, 400);
  assert.equal(classified.code, 'INVALID_JSON');
  assert.match(classified.message, /Unexpected token/);
});

test('an oversized body becomes 413 PAYLOAD_TOO_LARGE', () => {
  const err = Object.assign(new Error('request entity too large'), {
    type: 'entity.too.large',
    status: 413,
  });
  assert.equal(classifyError(err, false).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(classifyError(err, false).status, 413);
});

test('an unexpected throw is 500 INTERNAL_ERROR, and its message is hidden in production', () => {
  const err = new Error('connect ECONNREFUSED 10.0.0.3:5432 (password=hunter2)');

  const dev = classifyError(err, true);
  assert.equal(dev.status, 500);
  assert.equal(dev.code, 'INTERNAL_ERROR');
  assert.match(dev.message, /hunter2/);
  assert.equal(dev.serverFault, true);

  const prod = classifyError(err, false);
  assert.equal(prod.message, 'Internal server error');
  assert.ok(!prod.message.includes('hunter2'));
});

test('a non-Error throw does not crash the classifier', () => {
  assert.equal(classifyError('boom', true).message, 'boom');
  assert.equal(classifyError(undefined, false).code, 'INTERNAL_ERROR');
  assert.equal(classifyError({ statusCode: 403 }, true).status, 403);
});

test('errorHandler keeps the four parameters Express detects it by', () => {
  // Express registers an error handler on fn.length === 4 alone. Drop the
  // unused `next` and this silently becomes a normal middleware that never runs.
  assert.equal(errorHandler().length, 4);
  assert.equal(notFoundHandler().length, 2);
});

// ------------------------------------------------------------------ over HTTP

function buildApp() {
  const app = express();
  app.disable('x-powered-by');

  const api = express.Router();
  api.use(createServiceKeyMiddleware({ entries: parseServiceKeys(KEY), logger: () => {} }));
  api.use(express.json({ limit: '1kb' }));

  // Stand-ins for a tool router: one that works, one that throws outside any
  // try/catch, one that throws a ToolError from a helper.
  api.post('/tools/demo/ok', (_req, res) => {
    res.json({ ok: true, data: { pong: true } });
  });
  api.post('/tools/demo/boom', () => {
    throw new Error('kaboom from a route');
  });
  api.post('/tools/demo/tool-error', () => {
    throw new ToolError('MISSING_CREDENTIALS', 'credentials.apiKey is required');
  });

  app.use('/api', api);
  app.use(notFoundHandler());
  app.use(errorHandler({ exposeInternals: false, logger: () => {} }));
  return app;
}

async function withServer(fn: (base: string) => Promise<void>) {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** `Response.json()` is `Promise<unknown>` under @types/node; tests want the body. */
async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

const post = (base: string, path: string, body: string, key: string | null = KEY) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-service-key': key } : {}),
    },
    body,
  });

test('an unknown tool action answers the {ok:false} envelope, not an HTML page', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/tools/emai/send', '{}');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const body = await json(res);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.match(body.error.message, /Unknown tool action "emai\/send"/);
    assert.match(body.error.message, /GET \/api\/tools/);
  });
});

test('a GET on a tool action says so instead of an unexplained 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/tools/demo/ok`, { headers: { 'x-service-key': KEY } });
    const body = await json(res);
    assert.equal(res.status, 404);
    assert.match(body.error.message, /tool actions are POST; this request was GET/);
  });
});

test('a malformed JSON body answers 400 INVALID_JSON in the envelope', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/tools/demo/ok', '{"query": }');
    assert.equal(res.status, 400);

    const body = await json(res);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'INVALID_JSON');
    assert.equal(typeof body.error.message, 'string');
  });
});

test('a body over the parser cap answers 413 PAYLOAD_TOO_LARGE', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/tools/demo/ok', JSON.stringify({ blob: 'x'.repeat(4096) }));
    assert.equal(res.status, 413);
    assert.equal((await json(res)).error.code, 'PAYLOAD_TOO_LARGE');
  });
});

test('a throw outside a route try/catch answers 500 INTERNAL_ERROR without leaking it', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/tools/demo/boom', '{}');
    assert.equal(res.status, 500);

    const body = await json(res);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.error.message, 'Internal server error');
    assert.ok(!JSON.stringify(body).includes('kaboom'));
  });
});

test('a ToolError thrown from a helper reaches the caller as its own 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/tools/demo/tool-error', '{}');
    assert.equal(res.status, 400);

    const body = await json(res);
    assert.equal(body.error.code, 'MISSING_CREDENTIALS');
    assert.equal(body.error.message, 'credentials.apiKey is required');
  });
});

test('the error envelope names the caller that made the failing call', async () => {
  await withServer(async (base) => {
    const body = await json(await post(base, '/api/tools/demo/boom', '{}'));
    assert.equal(body.meta.caller, 'default');
  });
});

test('an unauthenticated request is refused before the body is even parsed', async () => {
  await withServer(async (base) => {
    // Malformed JSON *and* no key: the 401 must win, which only happens because
    // the key gate is mounted ahead of express.json().
    const res = await post(base, '/api/tools/demo/ok', '{ this is not json', null);
    assert.equal(res.status, 401);
    assert.equal((await json(res)).error.code, 'UNAUTHORIZED');
  });
});

test('a happy path is untouched by any of this', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/tools/demo/ok', '{}');
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, data: { pong: true } });
  });
});
