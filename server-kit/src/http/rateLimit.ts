/**
 * Dependency-free sliding-window rate limiter.
 *
 * Reconciled from Webum's `middleware/rate-limit.ts` (the only hand-rolled one
 * in the suite; the Manager and Profilum pull in `express-rate-limit`), with
 * three changes that the shared version needs:
 *
 *   1. Each limiter owns its store. Webum's module-level Map was shared by
 *      every limiter and keyed by route to compensate; separate stores make the
 *      route prefix unnecessary and stop one limiter's traffic from paying for
 *      another's sweep.
 *   2. The sweep is per-instance and its threshold is settable, so a test can
 *      prove the Map actually shrinks instead of hoping it does.
 *   3. The 429 body is the suite envelope, and `RateLimit-*` headers are set on
 *      every response (matching `express-rate-limit`'s `standardHeaders`), so
 *      swapping this in does not change what a client sees.
 *
 * Single-process only: counters live in memory and reset on restart. That is
 * what every API in the suite runs today (one container per env). Put a shared
 * store behind it before scaling an API horizontally.
 */

import type { Request, RequestHandler, Response } from 'express';
import { fail } from './envelope.js';

export interface RateLimitOptions {
  /** Width of the sliding window, in milliseconds. */
  windowMs: number;
  /** Requests tolerated per key inside the window. */
  max: number;
  /** Counting key. Default: `clientIp`. */
  keyFn?: (req: Request) => string;
  /** Body message for the 429. */
  message?: string;
  /** Error code in the 429 envelope. Default `RATE_LIMIT`. */
  code?: string;
  /** Skip counting entirely for some requests (health checks, service calls). */
  skip?: (req: Request) => boolean;
  /** Called once per rejection — for logging/alerting. */
  onLimit?: (req: Request, res: Response, key: string) => void;
  /** Amortised sweep: run a full expiry pass every N requests. Default 500. */
  sweepEvery?: number;
}

export interface RateLimitHandler extends RequestHandler {
  /** Drop every counter (tests, or an ops "unban everyone"). */
  reset(): void;
  /** Number of keys currently held — the memory-leak canary. */
  size(): number;
}

/**
 * Caller IP, honouring `x-forwarded-for` (nginx sits in front of every API in
 * the suite, so `req.socket.remoteAddress` is the proxy on every deployed env).
 *
 * The left-most entry of the list is the client. It is spoofable by anyone who
 * can reach the API directly — this is a throttle, not an authorisation check.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = (raw || req.socket?.remoteAddress || '').split(',')[0]?.trim();
  return candidate || 'unknown';
}

export function rateLimit(options: RateLimitOptions): RateLimitHandler {
  const {
    windowMs,
    max,
    keyFn = clientIp,
    message = 'Too many requests, please try again later.',
    code = 'RATE_LIMIT',
    skip,
    onLimit,
    sweepEvery = 500,
  } = options;

  if (!(windowMs > 0)) throw new TypeError('[server-kit] rateLimit: windowMs must be > 0');
  if (!(max > 0)) throw new TypeError('[server-kit] rateLimit: max must be > 0');

  /** key -> ascending timestamps of the hits still inside the window. */
  const hitsByKey = new Map<string, number[]>();
  let callsSinceSweep = 0;

  /**
   * Amortised expiry pass. Without it a key seen once stays in the Map for the
   * life of the process — the leak that a naive in-memory limiter always has.
   */
  function sweep(now: number): void {
    if (++callsSinceSweep < sweepEvery) return;
    callsSinceSweep = 0;
    for (const [key, hits] of hitsByKey) {
      const alive = hits.filter((t) => now - t < windowMs);
      if (alive.length === 0) hitsByKey.delete(key);
      else hitsByKey.set(key, alive);
    }
  }

  const handler = function rateLimiter(req: Request, res: Response, next: (err?: unknown) => void) {
    if (skip?.(req)) {
      next();
      return;
    }

    const now = Date.now();
    const key = keyFn(req);
    const hits = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);
    sweep(now);

    if (hits.length >= max) {
      // hits[0] is the oldest live hit: the window frees a slot when it expires.
      const retryAfterMs = windowMs - (now - hits[0]!);
      const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
      hitsByKey.set(key, hits);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', '0');
      res.setHeader('RateLimit-Reset', String(retryAfter));
      onLimit?.(req, res, key);
      res.status(429).json(fail(message, code));
      return;
    }

    hits.push(now);
    hitsByKey.set(key, hits);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - hits.length)));
    // Seconds until this key's window frees a slot — i.e. until the OLDEST live
    // hit falls out, not the full window width. A fixed `windowMs` here tells a
    // well-behaved client to back off far longer than it has to.
    res.setHeader('RateLimit-Reset', String(Math.max(1, Math.ceil((windowMs - (now - hits[0]!)) / 1000))));
    next();
  } as RateLimitHandler;

  handler.reset = () => {
    hitsByKey.clear();
    callsSinceSweep = 0;
  };
  handler.size = () => hitsByKey.size;

  return handler;
}
