/**
 * Accept EITHER a user bearer token OR the inter-service key.
 *
 * The Manager's `authOrServiceKey` (`backend/src/middlewares/auth.middleware.js`)
 * generalised: routes that a human and a sibling backend both call — the event
 * bus, the entitlement sync, CI fixtures.
 *
 * The service key is checked FIRST and, on a match, short-circuits: a machine
 * call must never pay a round trip to Supabase Auth.
 */

import type { RequestHandler } from 'express';
import { hasValidServiceKey, type ServiceKeyOptions } from './serviceKey.js';
import {
  supabaseBearerAuth,
  type SupabaseBearerAuthOptions,
} from './supabaseBearerAuth.js';
import type { SupabaseAuthCapableClient, SupabaseAuthUser } from '../types.js';

export interface AuthOrServiceKeyOptions<TUser = SupabaseAuthUser>
  extends SupabaseBearerAuthOptions<TUser>,
    ServiceKeyOptions {}

export function authOrServiceKey<TUser = SupabaseAuthUser>(
  client: SupabaseAuthCapableClient,
  serviceKey: string | undefined,
  options: AuthOrServiceKeyOptions<TUser> = {},
): RequestHandler {
  // `required` defaults to true here: a route mounted behind this one expects
  // one of the two identities, never an anonymous caller.
  const bearer = supabaseBearerAuth<TUser>(client, options);

  return function authOrServiceKeyMiddleware(req, res, next) {
    if (hasValidServiceKey(req, serviceKey, options)) {
      req.isService = true;
      next();
      return;
    }
    bearer(req, res, next);
  };
}
