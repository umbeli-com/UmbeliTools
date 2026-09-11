/**
 * CORS allowlist built from the suite's env convention.
 *
 * Three spellings are in production right now: `FRONTEND_ORIGIN` (Scrapium),
 * `CORS_ORIGINS` (Monitorum) and `CORS_ORIGIN` (Noesium, Servum) — all
 * comma-separated since the .ca migration, because prod and preprod are served
 * side by side (`scrapium.ca,www.scrapium.ca,scrapium.umbeli.com`). This reads
 * whichever is set, in that order, and always allows localhost so a dev front
 * on any Vite port works without an env file.
 *
 * `corsAllowlist()` returns something the `cors` package accepts directly
 * (`cors({ origin: allowlist.origin })`); `corsMiddleware()` does the same job
 * with no dependency at all, preflight included.
 */

import type { Request, RequestHandler, Response } from 'express';

export type EnvLike = Record<string, string | undefined>;

export interface CorsAllowlistOptions {
  /** Env keys to read, in priority order. */
  keys?: string[];
  /** Always allow localhost / 127.0.0.1 / [::1] on any port. Default true. */
  allowLocalhost?: boolean;
  /** Extra origins on top of the env (a preview domain, an admin console). */
  extra?: string[];
  /**
   * Allow requests with NO Origin header (curl, server-to-server, same-origin
   * navigations). Default true — those are not browser cross-origin requests
   * and blocking them only breaks health checks.
   */
  allowNoOrigin?: boolean;
}

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** `"a, b ,,b"` → `["a","b"]`, trimmed, de-duplicated, trailing slash removed. */
function splitOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim().replace(/\/+$/, '');
    if (value) seen.add(value);
  }
  return [...seen];
}

export interface CorsAllowlist {
  /** The explicit origins read from the env (localhost is implicit). */
  origins: string[];
  /** Which env key the list came from, or null when none was set. */
  source: string | null;
  isAllowed(origin: string | null | undefined): boolean;
  /** Drop-in for `cors({ origin })`. */
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => void;
}

export function corsAllowlist(
  env: EnvLike = process.env,
  options: CorsAllowlistOptions = {},
): CorsAllowlist {
  const {
    keys = ['FRONTEND_ORIGIN', 'CORS_ORIGINS', 'CORS_ORIGIN'],
    allowLocalhost = true,
    extra = [],
    allowNoOrigin = true,
  } = options;

  let source: string | null = null;
  let origins: string[] = [];
  for (const key of keys) {
    const parsed = splitOrigins(env[key]);
    if (parsed.length > 0) {
      source = key;
      origins = parsed;
      break;
    }
  }
  origins = [...new Set([...origins, ...splitOrigins(extra.join(','))])];

  const exact = new Set(origins);

  function isAllowed(candidate: string | null | undefined): boolean {
    if (!candidate) return allowNoOrigin;
    const normalized = candidate.trim().replace(/\/+$/, '');
    if (exact.has(normalized)) return true;
    if (allowLocalhost && LOCALHOST_RE.test(normalized)) return true;
    return false;
  }

  return {
    origins,
    source,
    isAllowed,
    origin(candidate, callback) {
      // `false` (not an Error): the request still completes, it simply gets no
      // CORS header — the browser is the one that blocks it. Handing `cors` an
      // Error turns a disallowed origin into a 500 in the app's logs.
      callback(null, isAllowed(candidate));
    },
  };
}

export interface CorsMiddlewareOptions extends CorsAllowlistOptions {
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAgeSeconds?: number;
}

/**
 * Append a field to `Vary` without dropping what another middleware already put
 * there. `res.setHeader('Vary', 'Origin')` clobbers `Vary: Accept-Encoding`.
 */
function addVary(res: Response, field: string): void {
  if (typeof res.getHeader !== 'function' || typeof res.setHeader !== 'function') return;
  const existing = res.getHeader('Vary');
  const current = Array.isArray(existing) ? existing.join(', ') : (existing ?? '').toString();
  if (current.trim() === '*') return;
  if (!current.trim()) {
    res.setHeader('Vary', field);
    return;
  }
  const already = current
    .split(',')
    .some((f) => f.trim().toLowerCase() === field.toLowerCase());
  if (already) return;
  res.setHeader('Vary', `${current}, ${field}`);
}

/**
 * Dependency-free CORS middleware. Answers preflights itself (204) and mirrors
 * the allowed origin back — never `*`, which browsers refuse to combine with
 * credentials.
 */
export function corsMiddleware(
  allowlistOrEnv: CorsAllowlist | EnvLike = process.env,
  options: CorsMiddlewareOptions = {},
): RequestHandler {
  const allowlist: CorsAllowlist =
    typeof (allowlistOrEnv as CorsAllowlist).isAllowed === 'function'
      ? (allowlistOrEnv as CorsAllowlist)
      : corsAllowlist(allowlistOrEnv as EnvLike, options);

  const {
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization', 'x-service-key', 'x-user-id'],
    exposedHeaders = [],
    credentials = true,
    maxAgeSeconds = 600,
  } = options;

  return function serverKitCors(req: Request, res: Response, next) {
    const origin = req.headers.origin;
    const allowed = allowlist.isAllowed(origin);

    // ALWAYS, not only when the origin is allowed: a shared cache that stored
    // the header-less answer given to a refused origin would otherwise replay
    // it to an allowed one, which then sees no CORS headers at all. Appended
    // rather than assigned, so a `Vary: Accept-Encoding` set upstream (compression)
    // survives.
    addVary(res, 'Origin');

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (exposedHeaders.length > 0) {
        res.setHeader('Access-Control-Expose-Headers', exposedHeaders.join(', '));
      }
    }

    if (req.method === 'OPTIONS') {
      if (origin && allowed) {
        res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
        res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
        res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
      }
      res.status(204).end();
      return;
    }

    next();
  };
}
