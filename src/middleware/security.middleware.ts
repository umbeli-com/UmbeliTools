/**
 * Security response headers — helmet's default set, hand-rolled.
 *
 * WHY NOT `helmet`: adding it means editing package.json, which this change is
 * not allowed to touch, and the container installs with `npm ci --omit=dev` so
 * a phantom dependency would crash the prod image on boot. The header set below
 * is helmet 8's default output, tightened for a JSON API (helmet's default CSP
 * still allows `'self'` scripts and styles; this service never serves a
 * document, so everything is denied). Swapping in the real package later is a
 * one-line change in `src/index.ts` — see README.
 *
 * These headers cost nothing on a machine-to-machine API, and they matter the
 * day someone opens an endpoint in a browser tab, or an error page ends up
 * framed somewhere.
 */

import type { Request, RequestHandler, Response, NextFunction } from 'express';

export interface SecurityHeadersOptions {
  /**
   * Send HSTS. TLS is terminated by nginx-proxy, so the container itself only
   * ever speaks plain HTTP — the header still has to be emitted for the browser
   * to see it. Default: on in production only.
   */
  hsts?: boolean;
  /** HSTS max-age in seconds. Default 180 days, helmet's default. */
  hstsMaxAgeSeconds?: number;
}

/** helmet's defaults, minus the ones that only make sense for HTML responses. */
const STATIC_HEADERS: ReadonlyArray<readonly [string, string]> = [
  // Nothing is ever loaded from a response of this service.
  [
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  ],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
  ['Referrer-Policy', 'no-referrer'],
  // Stops a browser from guessing that our application/json is something
  // executable — the header that makes a reflected payload inert.
  ['X-Content-Type-Options', 'nosniff'],
  ['X-DNS-Prefetch-Control', 'off'],
  ['X-Download-Options', 'noopen'],
  ['X-Frame-Options', 'DENY'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  // 0, not 1: the legacy XSS auditor introduced holes of its own, and helmet
  // has disabled it for years.
  ['X-XSS-Protection', '0'],
];

export function securityHeaders(options: SecurityHeadersOptions = {}): RequestHandler {
  const hsts = options.hsts ?? process.env.NODE_ENV === 'production';
  const maxAge = options.hstsMaxAgeSeconds ?? 15_552_000;

  return function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
    for (const [name, value] of STATIC_HEADERS) res.setHeader(name, value);
    if (hsts) {
      res.setHeader('Strict-Transport-Security', `max-age=${maxAge}; includeSubDomains`);
    }
    // Express advertises itself by default; there is no reason to tell a
    // scanner which framework and therefore which CVE list to try.
    res.removeHeader('X-Powered-By');
    next();
  };
}
