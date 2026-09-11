/**
 * The `x-service-key` gate — the ONLY barrier in front of this service, which
 * is publicly exposed at api.tools.umbeli.com and brokers credentials for
 * Anthropic, OpenAI, Mailjet, Twilio, Cloudflare, Gandi and Meta.
 *
 * Three things changed here:
 *
 *  1. `provided !== key` is gone. A plain string compare returns as soon as two
 *     bytes differ, so the time it takes leaks the key's prefix one byte at a
 *     time to anyone who can measure it. `crypto.timingSafeEqual` does not —
 *     but it THROWS on buffers of unequal length, hence the length check first
 *     (a length mismatch is not a secret worth hiding).
 *  2. Several keys are accepted, each carrying a caller identity, so a key can
 *     be rotated per app and, above all, so a call can be ATTRIBUTED. Until now
 *     every log line said the same thing about every caller: nothing.
 *  3. The matched caller is attached to the request (`req.caller`) and printed
 *     by the request logger.
 *
 * Unconfigured is a 500, not a 401: an empty key must never be able to match an
 * empty header, and a caller should not be told to fix its own credentials when
 * the fault is ours.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ENV, type ServiceKeyEntry } from '../config/env';
import { sendError } from '../lib/response';
import { ErrorCode, statusForCode } from '../lib/errors';

/** Who is calling, once the key checks out. */
export interface ServiceCaller {
  /** Identity from `UMBELIUM_SERVICE_KEY` (`webum:…` → `webum`). */
  name: string;
  /** How the caller authenticated. One value today; kept for future schemes. */
  via: 'x-service-key';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `serviceKeyMiddleware` once the key matched. */
      caller?: ServiceCaller;
    }
  }
}

export const SERVICE_KEY_HEADER = 'x-service-key';

/**
 * Constant-time string equality. Never throws, whatever it is handed.
 *
 * The length check is deliberate and unavoidable: `crypto.timingSafeEqual`
 * raises `RangeError: Input buffers must have the same byte length` rather than
 * returning false, so a naive call would 500 on every wrong-length key.
 */
export function timingSafeEqualStr(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** The key a request presents, if any. */
export function serviceKeyFrom(req: Request, header: string = SERVICE_KEY_HEADER): string | null {
  const raw = req.headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The entry whose key matches, or null.
 *
 * EVERY entry is compared — no early exit — so the number of configured keys
 * and the position of the matching one do not show up in the response time.
 */
export function matchServiceKey(
  provided: string | null,
  entries: readonly ServiceKeyEntry[],
): ServiceKeyEntry | null {
  if (!provided) return null;
  let matched: ServiceKeyEntry | null = null;
  for (const entry of entries) {
    if (timingSafeEqualStr(provided, entry.key) && matched === null) matched = entry;
  }
  return matched;
}

/**
 * A short, non-reversible fingerprint of a rejected key, so a 401 can be
 * matched against the caller's config without the secret entering the logs.
 */
export function keyFingerprint(provided: string | null): string {
  if (!provided) return 'none';
  return crypto.createHash('sha256').update(provided).digest('hex').slice(0, 8);
}

export interface ServiceKeyOptions {
  /** Accepted keys. Defaults to the ones parsed from the env. */
  entries?: readonly ServiceKeyEntry[];
  /** Header to read. Defaults to `x-service-key`. */
  header?: string;
  /** Where rejections go. Defaults to `console.warn`. */
  logger?: (line: string) => void;
}

/** Build a gate over an explicit key list — used by the tests. */
export function createServiceKeyMiddleware(options: ServiceKeyOptions = {}): RequestHandler {
  const header = options.header ?? SERVICE_KEY_HEADER;
  const log = options.logger ?? ((line: string) => console.warn(line));

  return function serviceKeyGuard(req: Request, res: Response, next: NextFunction) {
    // Read the list per request so a test (or a future SIGHUP reload) sees the
    // current value rather than one frozen at mount time.
    const entries = options.entries ?? ENV.SERVICE_KEYS;

    if (entries.length === 0) {
      log('[auth] request refused: no service key is configured on this server');
      return sendError(
        res,
        statusForCode(ErrorCode.CONFIG_ERROR),
        ErrorCode.CONFIG_ERROR,
        'UMBELIUM_SERVICE_KEY is not configured',
      );
    }

    const provided = serviceKeyFrom(req, header);
    const caller = matchServiceKey(provided, entries);

    if (!caller) {
      log(
        `[auth] 401 ${req.method} ${req.originalUrl || req.url} — key=${keyFingerprint(provided)} ip=${clientIp(req)}`,
      );
      return sendError(
        res,
        statusForCode(ErrorCode.UNAUTHORIZED),
        ErrorCode.UNAUTHORIZED,
        `Invalid or missing ${header}`,
      );
    }

    req.caller = { name: caller.name, via: 'x-service-key' };
    return next();
  };
}

/**
 * Caller IP for logs and throttling. Honours `x-forwarded-for` because
 * nginx-proxy sits in front of every deployed environment, so the socket
 * address is the proxy's. Left-most entry is the client, and it is spoofable
 * by anyone who can reach the container directly — good enough to label a log
 * line, never good enough to authorise anything.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = (raw || req.socket?.remoteAddress || '').split(',')[0]?.trim();
  return candidate || 'unknown';
}

/**
 * The default gate, bound to the process env.
 *
 * Same signature as before — `api.use(serviceKeyMiddleware)` still works, and
 * so does calling it directly in a test.
 */
export const serviceKeyMiddleware: RequestHandler = createServiceKeyMiddleware();
