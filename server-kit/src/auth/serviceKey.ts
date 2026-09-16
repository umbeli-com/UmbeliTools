/**
 * Inter-service key: the header every Umbeli backend trusts for machine calls.
 *
 * The Manager already compares in constant time
 * (`backend/src/utils/timingSafe.js`); UmbeliTools, Noesium and Servum still do
 * `provided !== key`, a plain string compare that leaks the key's prefix one
 * byte at a time to anyone who can measure the response. This is that Manager
 * version, typed, with the `timingSafeEqual` sharp edge handled explicitly:
 * IT THROWS on buffers of unequal length, so the length check comes first (and
 * a length mismatch is not a secret worth hiding).
 */

import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import {
  envelopeErrorFormat,
  respondError,
  type ErrorFormatOption,
} from '../http/envelope.js';

/** Constant-time string equality. Never throws, whatever it is handed. */
export function timingSafeEqualStr(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // crypto.timingSafeEqual THROWS ("Input buffers must have the same byte
  // length") on a mismatch — hence this guard, not an else-branch.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface ServiceKeyOptions extends ErrorFormatOption {
  /** Header carrying the key. Default `x-service-key` (the suite convention). */
  header?: string;
  /** Extra keys accepted — for a rotation window. */
  alsoAccept?: string[];
  /**
   * Status for a missing/invalid key. Default 401.
   *
   * Servum answers 403 (`requireServiceKey` in
   * `apps/api/src/middlewares/auth.ts`). 401 is the better answer — the caller
   * has not identified itself — but "better" is not worth changing what a
   * deployed client already branches on, so the number is an argument.
   */
  status?: number;
  /** Message for a missing/invalid key. Default `Invalid or missing service key`. */
  message?: string;
  /**
   * `true` (default): a server started with no key answers 500 CONFIG_ERROR.
   * An unconfigured service that answered 401/403 would look like a CALLER
   * mistake, and the suite has already lost an afternoon to exactly that.
   *
   * `false`: no key configured simply rejects like a wrong key — what Servum,
   * UmbeliTools and Noesium do today. Set it only to keep an existing contract
   * byte-identical; it hides a deployment fault behind an auth failure.
   */
  requireConfigured?: boolean;
}

/** Read the service key a request presents, if any. */
export function serviceKeyFrom(req: Request, header = 'x-service-key'): string | null {
  const raw = req.headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** True if the request presents one of the configured keys. */
export function hasValidServiceKey(
  req: Request,
  key: string | undefined,
  options: ServiceKeyOptions = {},
): boolean {
  const provided = serviceKeyFrom(req, options.header ?? 'x-service-key');
  if (!provided) return false;
  const accepted = [key, ...(options.alsoAccept ?? [])].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );
  // Every candidate is compared — no early exit, so the count of configured
  // keys does not change the timing profile of a wrong key.
  let match = false;
  for (const candidate of accepted) {
    if (timingSafeEqualStr(provided, candidate)) match = true;
  }
  return match;
}

/**
 * Gate a router behind the inter-service key.
 *
 * A MISSING key is a 500, not a 401: an unconfigured service that answered 401
 * would look like a caller mistake, and the suite has already lost an afternoon
 * to that. It also means an empty `UMBELIUM_SERVICE_KEY` can never accidentally
 * match an empty header.
 */
export function serviceKeyMiddleware(
  key: string | undefined,
  options: ServiceKeyOptions = {},
): RequestHandler {
  const {
    format = envelopeErrorFormat,
    status = 401,
    message = 'Invalid or missing service key',
    requireConfigured = true,
  } = options;

  return function serviceKeyGuard(req: Request, res: Response, next) {
    if (!key && requireConfigured) {
      respondError(
        res,
        {
          status: 500,
          code: 'CONFIG_ERROR',
          message: 'Service key is not configured on this server',
        },
        format,
      );
      return;
    }
    if (!hasValidServiceKey(req, key, options)) {
      respondError(res, { status, code: 'UNAUTHORIZED', message }, format);
      return;
    }
    req.isService = true;
    next();
  };
}
