/**
 * UmbeliTools — the suite's shared toolbox service.
 *
 * The middleware ORDER below is the security boundary; each step is placed
 * where it is on purpose:
 *
 *   1. security headers   — on every response, including error responses
 *   2. CORS               — answers preflights before anything else runs
 *   3. request log        — assigns the request id the rest of the chain uses
 *   4. rate limit         — BEFORE body parsing, so a flood costs us no parsing
 *   5. /api/health        — unauthenticated, exempt from the limiter (the
 *                           container's own HEALTHCHECK hits it every 30s)
 *   6. service key        — BEFORE `express.json()`: an unauthenticated caller
 *                           must never be able to make us parse 2 MB of JSON
 *   7. express.json()     — tool routes read `req.body`
 *   8. tools
 *   9. 404 then the error handler — both answer the `{ ok, … }` envelope
 */

import express from 'express';
import { ENV, validateEnv } from './config/env';
import { securityHeaders } from './middleware/security.middleware';
import { corsMiddleware } from './middleware/cors.middleware';
import { rateLimit } from './middleware/rateLimit.middleware';
import { serviceKeyMiddleware } from './middleware/serviceKey.middleware';
import { requestLogger } from './middleware/requestLogger.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { mountTools } from './tools';

const HEALTH_PATH = '/api/health';

/**
 * Fail fast. Booting without a service key used to be survivable: the process
 * came up, `/api/health` answered 200, the container reported healthy, and
 * every real call got 500 CONFIG_ERROR. A dead container is a far louder — and
 * far cheaper — signal than a healthy one that serves nothing.
 */
try {
  validateEnv();
} catch (err) {
  console.error(`[UmbeliTools] refusing to start — ${(err as Error).message}`);
  process.exit(1);
}

export const app = express();

app.disable('x-powered-by');
// nginx-proxy terminates TLS and forwards; without this every client looks
// like the proxy and the rate limiter counts the whole internet as one caller.
app.set('trust proxy', ENV.TRUST_PROXY);

app.use(securityHeaders());
app.use(corsMiddleware());
app.use(requestLogger);
app.use(
  rateLimit({
    skip: (req) => req.path === HEALTH_PATH,
    onLimit: (req, key) =>
      console.warn(`[rate-limit] 429 ${req.method} ${req.originalUrl} key=${key}`),
  }),
);

// Health check (no auth required).
app.get(HEALTH_PATH, (_req, res) => {
  res.json({ ok: true, service: 'umbeli-tools', version: '1.0.0' });
});

// All /api routes require the service key.
const api = express.Router();
api.use(serviceKeyMiddleware);
api.use(express.json({ limit: ENV.JSON_BODY_LIMIT }));
mountTools(api);
app.use('/api', api);

// Terminal handlers. Order matters and so does the error handler's arity:
// Express recognises an error handler by its four parameters alone.
app.use(notFoundHandler());
app.use(errorHandler());

/**
 * Express 4 does not forward a rejected promise from an async route handler to
 * the error middleware, and Node 20 kills the process on an unhandled
 * rejection. One buggy tool route must not take down the toolbox for all six
 * apps: log it with everything needed to find it, and stay up. (The real fix is
 * an `asyncHandler` wrapper around each route, or Express 5 — see README.)
 */
process.on('unhandledRejection', (reason) => {
  console.error('[UmbeliTools] unhandled promise rejection (request will hang):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UmbeliTools] uncaught exception — exiting:', err);
  process.exit(1);
});

const server = app.listen(ENV.PORT, () => {
  const callers = ENV.SERVICE_KEYS.map((k) => k.name).join(', ');
  console.log(
    `[UmbeliTools] Running on port ${ENV.PORT} (${ENV.NODE_ENV}) — ${ENV.SERVICE_KEYS.length} service key(s): ${callers}`,
  );
});

// `docker stop` sends SIGTERM: finish in-flight tool calls instead of cutting
// an upstream provider call in half.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[UmbeliTools] ${signal} received — draining`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
