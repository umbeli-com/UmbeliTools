/**
 * Sliding-window rate limiter, dependency-free (see the note in
 * security.middleware.ts about why nothing new is installed).
 *
 * This is the shape already proven in the suite — Webum's hand-rolled limiter,
 * reconciled in `server-kit/src/http/rateLimit.ts` — with two differences: the
 * 429 body is THIS service's `{ ok, error }` envelope, and the counting key
 * prefers the authenticated caller over the IP when one is known, so one app
 * hammering the service cannot spend another app's quota just because both sit
 * behind the same nginx-proxy address.
 *
 * Single process only: counters live in memory and reset on restart. That is
 * exactly what runs today (one container per environment). Anything horizontal
 * needs a shared store first.
 */

import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { ENV } from '../config/env';
import { ErrorCode, statusForCode } from '../lib/errors';
import { sendError } from '../lib/response';
import { clientIp } from './serviceKey.middleware';

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  /** Counting key. Default: caller identity when authenticated, else IP. */
  keyFn?: (req: Request) => string;
  /** Requests that are never counted. Default: none. */
  skip?: (req: Request) => boolean;
  /** Called once per rejection, for logging. */
  onLimit?: (req: Request, key: string) => void;
  /** Amortised expiry pass every N requests. Default 500. */
  sweepEvery?: number;
}

export interface RateLimitHandler extends RequestHandler {
  /** Drop every counter (tests, or an ops "unban everyone"). */
  reset(): void;
  /** Keys currently held — the memory-leak canary. */
  size(): number;
}

/** Caller identity when the key already checked out, IP otherwise. */
export function defaultRateLimitKey(req: Request): string {
  return req.caller ? `caller:${req.caller.name}` : `ip:${clientIp(req)}`;
}

export function rateLimit(options: RateLimitOptions = {}): RateLimitHandler {
  const windowMs = options.windowMs ?? ENV.RATE_LIMIT_WINDOW_MS;
  const max = options.max ?? ENV.RATE_LIMIT_MAX;
  const keyFn = options.keyFn ?? defaultRateLimitKey;
  const sweepEvery = options.sweepEvery ?? 500;
  const { skip, onLimit } = options;

  if (!(windowMs > 0)) throw new TypeError('rateLimit: windowMs must be > 0');
  if (!(max > 0)) throw new TypeError('rateLimit: max must be > 0');

  /** key → ascending timestamps of the hits still inside the window. */
  const hitsByKey = new Map<string, number[]>();
  let callsSinceSweep = 0;

  /**
   * Without this pass, a key seen once stays in the Map for the life of the
   * process — the leak every naive in-memory limiter ships with.
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

  const handler = function rateLimiter(req: Request, res: Response, next: NextFunction) {
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
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - hits[0]!)) / 1000));
      hitsByKey.set(key, hits);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', '0');
      res.setHeader('RateLimit-Reset', String(retryAfter));
      onLimit?.(req, key);
      sendError(
        res,
        statusForCode(ErrorCode.RATE_LIMIT),
        ErrorCode.RATE_LIMIT,
        'Too many requests, please retry later',
        undefined,
        { retryAfterSeconds: retryAfter, limit: max, windowMs },
      );
      return;
    }

    hits.push(now);
    hitsByKey.set(key, hits);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - hits.length)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(windowMs / 1000)));
    next();
  } as RateLimitHandler;

  handler.reset = () => {
    hitsByKey.clear();
    callsSinceSweep = 0;
  };
  handler.size = () => hitsByKey.size;

  return handler;
}
