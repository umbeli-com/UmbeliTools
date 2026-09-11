/**
 * Explicit CORS policy.
 *
 * The policy this service wants is DENY: it is called server-to-server by the
 * suite's backends, and the README is emphatic that `x-service-key` must never
 * reach a browser bundle. With no `Access-Control-Allow-Origin` header a
 * browser refuses to hand the response to page JavaScript, which is exactly
 * right — and it makes an accidental "call UmbeliTools from the frontend"
 * fail loudly in development instead of shipping the key to production.
 *
 * An allowlist is still supported (`TOOLS_CORS_ORIGINS`, or the suite's other
 * spellings — see `src/config/env.ts`) for the one case that justifies it: an
 * internal console served from a known origin. `*` is never sent, and the
 * allowed origin is echoed back per request so credentials stay usable.
 *
 * Dependency-free for the same reason as the security headers: package.json is
 * out of scope for this change.
 */

import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export interface CorsOptions {
  /** Exact origins allowed. Default: `ENV.CORS_ORIGINS` (usually empty). */
  origins?: readonly string[];
  /** Allow any localhost port. Default: outside production only. */
  allowLocalhost?: boolean;
  methods?: readonly string[];
  allowedHeaders?: readonly string[];
  maxAgeSeconds?: number;
}

export function isOriginAllowed(
  origin: string | undefined,
  origins: readonly string[],
  allowLocalhost: boolean,
): boolean {
  if (!origin) return false; // no Origin header = not a browser CORS request
  const normalized = origin.trim().replace(/\/+$/, '');
  if (origins.includes(normalized)) return true;
  return allowLocalhost && LOCALHOST_RE.test(normalized);
}

export function corsMiddleware(options: CorsOptions = {}): RequestHandler {
  const origins = options.origins ?? ENV.CORS_ORIGINS;
  const allowLocalhost = options.allowLocalhost ?? !ENV.IS_PRODUCTION;
  const methods = options.methods ?? ['GET', 'POST', 'OPTIONS'];
  const allowedHeaders = options.allowedHeaders ?? ['Content-Type', 'x-service-key', 'x-request-id'];
  const maxAgeSeconds = options.maxAgeSeconds ?? 600;

  return function cors(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(origin, origins, allowLocalhost);

    if (origin) {
      // Always vary: without it a shared cache can serve one origin's CORS
      // headers (or their absence) to another.
      res.setHeader('Vary', 'Origin');
    }

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      if (origin && allowed) {
        res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
        res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
        res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
      }
      // 204 either way. A preflight that is answered without the allow headers
      // is what tells the browser to block — answering 4xx here produces a
      // uselessly vague console error instead.
      res.status(204).end();
      return;
    }

    next();
  };
}
