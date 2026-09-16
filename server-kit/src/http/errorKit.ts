/**
 * `createErrorKit({ format })` — declare the app's error shape ONCE.
 *
 * WHY A FACTORY AND NOT JUST THE PER-MIDDLEWARE OPTION.
 *
 * Both exist, and the per-middleware `format` is what this is built on. The
 * factory is the one to reach for, for a reason that is not about typing
 * fewer characters: the failure mode here is a MISS, not a mistake.
 *
 * Counted on a real adoption (Servum's `apps/api/src/index.ts`), the guards
 * and handlers that can answer an error are five: `supabaseBearerAuth`,
 * `serviceKeyMiddleware`, `rateLimit`, `notFoundHandler`, `errorHandler`.
 * Passing `format` to each is five chances to forget one — and the one that is
 * forgotten does not fail a build, a typecheck or a test. It ships, and some
 * rare path (a 429, a 404 on a typo'd route, a 503 when Supabase blinks)
 * answers in the other shape. That is precisely the bug that already happened:
 * Servum's `apps/web/src/lib/api.ts` now carries an `errorMessage()` whose only
 * job is to un-tangle two shapes coming out of one API.
 *
 * With the factory the shape is declared once and cannot be missed:
 *
 *   const http = createErrorKit({ format: errorFormats.flat });
 *   app.use('/api', http.rateLimit({ windowMs: 60_000, max: 120 }));
 *   app.use('/api/private', http.supabaseBearerAuth(supabase));
 *   app.use('/api/internal', http.serviceKeyMiddleware(ENV.SERVICE_KEY, { status: 403 }));
 *   app.use(http.notFoundHandler());
 *   app.use(http.errorHandler());
 *
 * A per-call `format` still wins over the kit's, for the one route that must
 * answer differently.
 */

import type { Request, RequestHandler, Response } from 'express';
import {
  envelopeErrorFormat,
  errorHandler,
  notFoundHandler,
  ok,
  fail,
  respondError,
  sendSuccess,
  type ErrorFormat,
  type ErrorHandlerOptions,
  type ErrorPayload,
  type NotFoundHandlerOptions,
} from './envelope.js';
import { rateLimit, type RateLimitHandler, type RateLimitOptions } from './rateLimit.js';
import {
  serviceKeyMiddleware,
  type ServiceKeyOptions,
} from '../auth/serviceKey.js';
import {
  supabaseBearerAuth,
  type SupabaseBearerAuthOptions,
} from '../auth/supabaseBearerAuth.js';
import {
  authOrServiceKey,
  type AuthOrServiceKeyOptions,
} from '../auth/authOrServiceKey.js';
import type { SupabaseAuthCapableClient, SupabaseAuthUser } from '../types.js';

export interface CreateErrorKitOptions {
  /**
   * Error body shape for every middleware this kit builds.
   * Default: the kit envelope — an app that passes nothing changes nothing.
   */
  format?: ErrorFormat;
  /** Default `logger` for `errorHandler()` built here. */
  logger?: (err: unknown, req: Request) => void;
  /** Default `exposeInternals` for `errorHandler()` built here. */
  exposeInternals?: boolean;
}

/** Everything that can answer an error, pre-bound to one shape. */
export interface ErrorKit {
  /** The shape this kit writes. Handy to pass on to an app's own helpers. */
  readonly format: ErrorFormat;

  errorHandler(options?: ErrorHandlerOptions): ReturnType<typeof errorHandler>;
  notFoundHandler(options?: NotFoundHandlerOptions): RequestHandler;
  rateLimit(options: RateLimitOptions): RateLimitHandler;
  serviceKeyMiddleware(key: string | undefined, options?: ServiceKeyOptions): RequestHandler;
  supabaseBearerAuth<TUser = SupabaseAuthUser>(
    client: SupabaseAuthCapableClient,
    options?: SupabaseBearerAuthOptions<TUser>,
  ): RequestHandler;
  authOrServiceKey<TUser = SupabaseAuthUser>(
    client: SupabaseAuthCapableClient,
    serviceKey: string | undefined,
    options?: AuthOrServiceKeyOptions<TUser>,
  ): RequestHandler;

  /** Write an error from a route, in this kit's shape. */
  respondError(res: Response, payload: ErrorPayload): Response;
  /** Same argument order as the free `sendError`, in this kit's shape. */
  sendError(
    res: Response,
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ): Response;

  /**
   * Success is NOT reshaped — these are the free functions, unchanged. A
   * success body is only ever written by a route that chose to call one of
   * them, so there was never a shape to inherit; error bodies come out of
   * middleware the app does not write, which is the whole problem.
   */
  ok: typeof ok;
  fail: typeof fail;
  sendSuccess: typeof sendSuccess;
}

export function createErrorKit(options: CreateErrorKitOptions = {}): ErrorKit {
  const { format = envelopeErrorFormat, logger, exposeInternals } = options;

  /**
   * A per-call option overrides the kit's — but only when it actually CARRIES
   * one. A plain `{ ...kitDefault, ...o }` would let `{ format: undefined }`
   * (what an object spread of a config with an unset field produces) silently
   * drop the kit's shape back to the envelope, which is precisely the
   * one-middleware-in-the-other-shape bug the factory exists to prevent.
   */
  const withDefaults = <T extends object>(o: T | undefined, defaults: Partial<T>): T => {
    const merged = { ...defaults } as Record<string, unknown>;
    for (const [key, value] of Object.entries((o ?? {}) as Record<string, unknown>)) {
      if (value !== undefined || !(key in merged)) merged[key] = value;
    }
    return merged as T;
  };

  const withFormat = <T extends { format?: ErrorFormat }>(o?: T): T =>
    withDefaults(o, { format } as Partial<T>);

  return {
    format,

    errorHandler: (o) =>
      errorHandler(
        withDefaults(o, {
          format,
          ...(logger !== undefined ? { logger } : {}),
          ...(exposeInternals !== undefined ? { exposeInternals } : {}),
        }),
      ),
    notFoundHandler: (o) => notFoundHandler(withFormat(o)),
    rateLimit: (o) => rateLimit(withFormat(o)),
    serviceKeyMiddleware: (key, o) => serviceKeyMiddleware(key, withFormat(o)),
    supabaseBearerAuth: <TUser = SupabaseAuthUser>(
      client: SupabaseAuthCapableClient,
      o?: SupabaseBearerAuthOptions<TUser>,
    ) => supabaseBearerAuth<TUser>(client, withFormat(o)),
    authOrServiceKey: <TUser = SupabaseAuthUser>(
      client: SupabaseAuthCapableClient,
      serviceKey: string | undefined,
      o?: AuthOrServiceKeyOptions<TUser>,
    ) => authOrServiceKey<TUser>(client, serviceKey, withFormat(o)),

    respondError: (res, payload) => respondError(res, payload, format),
    sendError: (res, statusCode, code, message, details) =>
      respondError(res, { status: statusCode, code, message, details }, format),

    ok,
    fail,
    sendSuccess,
  };
}
