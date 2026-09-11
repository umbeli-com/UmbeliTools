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
import { sendError } from '../http/envelope.js';
import type { SupabaseAuthCapableClient, SupabaseAuthUser } from '../types.js';

export interface SupabaseBearerAuthOptions<TUser = SupabaseAuthUser> {
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
  } = options;

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
        sendError(res, 401, 'UNAUTHORIZED', 'Missing bearer token');
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
          sendError(res, 503, 'AUTH_UNAVAILABLE', 'Authentication backend unavailable');
          return;
        }
        next();
        return;
      }

      if (!user) {
        if (required) {
          sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
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
            sendError(res, 403, 'FORBIDDEN', 'Account is not provisioned for this service');
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
