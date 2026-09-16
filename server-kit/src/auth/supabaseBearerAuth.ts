/**
 * `Authorization: Bearer <supabase jwt>` → `req.userId` / `req.user`.
 *
 * Reconciled from Webum's `middleware/auth.ts` (the best of the nine: it strips
 * the scheme case-insensitively, maps the Supabase user into the app's own
 * shape, and — since the prod incident — refuses to fall back to a dev account),
 * the Manager's `auth.middleware.js` and Servum's `requireAuth`.
 *
 * Deliberate differences from all three:
 *   - No dev-user fallback of any kind. That belongs to an app, not to a shared
 *     kit; a shared default account is how one forgotten guard becomes a tenant
 *     leak in every app at once.
 *   - A THROWN error (Supabase unreachable) answers 503, not 401. An expired
 *     token and a Supabase outage are different incidents and must not look
 *     alike in the logs.
 *   - Soft mode (`required: false`) continues unauthenticated instead of
 *     answering — Profilum's `optionalAuth`, which public bio pages need.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  envelopeErrorFormat,
  respondError,
  type ErrorFormatOption,
} from '../http/envelope.js';
import type { SupabaseAuthCapableClient, SupabaseAuthUser } from '../types.js';

export interface SupabaseBearerAuthOptions<TUser = SupabaseAuthUser>
  extends ErrorFormatOption {
  /**
   * `true` (default): answer 401 when there is no valid token.
   * `false`: continue with `req.userId` undefined — the caller's route decides.
   */
  required?: boolean;
  /**
   * Map the Supabase user onto the app's own user object before it is put on
   * `req.user`. Webum's `userFromJwt` is exactly this. May be async (a DB
   * lookup — Profilum resolves a local `users` row here).
   */
  mapUser?: (user: SupabaseAuthUser, req: Request) => TUser | Promise<TUser>;
  /** Property to attach the mapped user to. Default `user`. */
  userProperty?: string;
  /**
   * Also accept `?token=` in the query string. Off by default. Servum needs it
   * for EventSource and direct download links, which cannot set a header —
   * turn it on ONLY for those routes: query strings land in access logs.
   */
  allowQueryToken?: boolean;
  /** Query parameter to read when `allowQueryToken` is on. Default `token`. */
  queryParam?: string;
  /** Called when the auth backend itself fails. Default: `console.error`. */
  onAuthBackendError?: (err: unknown, req: Request) => void;
  /**
   * Override the four rejection messages. Every default is unchanged unless
   * the key is present.
   *
   * `format: errorFormats.flat` alone gets an adopter the SHAPE of its legacy
   * body, not its TEXT — and the suite's texts are all different for the same
   * branch:
   *
   *   - Servum  `apps/api/src/middlewares/auth.ts`: `"Missing authorization header"`
   *   - Webum   `apps/api/src/middleware/auth.ts`: `"Authorization header missing"`
   *     when there is no header at all, `"Bearer token missing"` when there is
   *     one it cannot parse — which is why these take the request: the kit has
   *     a single no-token branch and an adopter may need to split it.
   *
   * Only `"Invalid or expired token"` is already common to both.
   */
  messages?: {
    /** No bearer token (and no `?token=`) on a required route. 401. */
    missingToken?: string | ((req: Request) => string);
    /** Supabase rejected the token. 401. */
    invalidToken?: string | ((req: Request) => string);
    /** `auth.getUser()` threw — Supabase is unreachable. 503. */
    authUnavailable?: string | ((req: Request) => string);
    /** `mapUser` returned null/undefined — no local account. 403. */
    notProvisioned?: string | ((req: Request) => string);
  };
}

/** Extract a bearer token from the Authorization header. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

/**
 * @param client any Supabase client — anon or service role. `auth.getUser(jwt)`
 *               verifies the token against Supabase Auth regardless of which
 *               key the client was built with.
 */
export function supabaseBearerAuth<TUser = SupabaseAuthUser>(
  client: SupabaseAuthCapableClient,
  options: SupabaseBearerAuthOptions<TUser> = {},
): RequestHandler {
  const {
    required = true,
    mapUser,
    userProperty = 'user',
    allowQueryToken = false,
    queryParam = 'token',
    onAuthBackendError = (err: unknown) =>
      console.error('[server-kit] supabase auth backend error:', err),
    // The reason Webum took `bearerToken()` and left this middleware alone:
    // its admin reads `body.error` as a string. `format: errorFormats.flat`
    // makes every 401 below `{ error: "…" }` — the SHAPE Webum and Servum write
    // by hand. Their TEXT differs from the kit's and from each other, so
    // byte-identity needs `messages` too; see the option below.
    format = envelopeErrorFormat,
    messages = {},
  } = options;

  const DEFAULT_MESSAGES = {
    missingToken: 'Missing bearer token',
    invalidToken: 'Invalid or expired token',
    authUnavailable: 'Authentication backend unavailable',
    notProvisioned: 'Account is not provisioned for this service',
  } as const;

  type DenyKind = keyof typeof DEFAULT_MESSAGES;

  const deny = (
    req: Request,
    res: Response,
    status: number,
    code: string,
    kind: DenyKind,
  ): void => {
    const override = messages[kind];
    let message: string = DEFAULT_MESSAGES[kind];
    if (typeof override === 'string') {
      message = override;
    } else if (typeof override === 'function') {
      // A caller-supplied message runs on the rejection path, where nothing is
      // left to catch a throw: it would answer nothing at all on the exact
      // request that must be refused. Fall back to the kit's text instead.
      try {
        const produced = override(req);
        if (typeof produced === 'string' && produced.length > 0) message = produced;
      } catch (err) {
        console.error('[server-kit] auth message threw; using the default:', err);
      }
    }
    respondError(res, { status, code, message }, format);
  };

  return function supabaseBearerAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    let token = bearerToken(req);
    if (!token && allowQueryToken) {
      const q = (req.query as Record<string, unknown> | undefined)?.[queryParam];
      if (typeof q === 'string' && q.length > 0) token = q;
    }

    if (!token) {
      if (required) {
        deny(req, res, 401, 'UNAUTHORIZED', 'missingToken');
        return;
      }
      next();
      return;
    }

    // Not `async function` — an Express 4 handler that returns a rejected
    // promise crashes the process instead of reaching the error handler. The
    // `.catch()` below closes the same hole from the inside: a throw from a
    // caller-supplied `onAuthBackendError`, or from `res` on a socket that just
    // died, would otherwise be an unhandledRejection, which Node >= 15 turns
    // into a process exit.
    void (async () => {
      let user: SupabaseAuthUser | null;
      try {
        const { data, error } = await client.auth.getUser(token!);
        user = error ? null : (data?.user ?? null);
      } catch (err) {
        // Thrown, not returned: the auth backend is down, the token may be fine.
        onAuthBackendError(err, req);
        if (required) {
          deny(req, res, 503, 'AUTH_UNAVAILABLE', 'authUnavailable');
          return;
        }
        next();
        return;
      }

      if (!user) {
        if (required) {
          deny(req, res, 401, 'UNAUTHORIZED', 'invalidToken');
          return;
        }
        next();
        return;
      }

      req.userId = user.id;
      req.authUser = user;
      try {
        const mapped = mapUser ? await mapUser(user, req) : (user as unknown as TUser);
        if (mapped === null || mapped === undefined) {
          // The mapper refused this identity (no local row, deleted account…).
          if (required) {
            deny(req, res, 403, 'FORBIDDEN', 'notProvisioned');
            return;
          }
          next();
          return;
        }
        (req as unknown as Record<string, unknown>)[userProperty] = mapped;
      } catch (err) {
        next(err);
        return;
      }
      next();
    })().catch((err: unknown) => {
      if (res.headersSent || res.writableEnded) {
        console.error('[server-kit] supabaseBearerAuth failed after responding:', err);
        return;
      }
      next(err);
    });
  };
}
