/**
 * @umbeli-com/server-kit — the Express plumbing every Umbeli backend rewrites.
 *
 * Dual CJS + ESM. See README.md for the packaging contract and for the
 * per-export notes on WHICH backend each implementation came from.
 */

export type {
  SupabaseAuthUser,
  SupabaseAuthCapableClient,
  SupabaseServiceClient,
} from './types.js';

// ── Auth ────────────────────────────────────────────────────────────────
export {
  supabaseBearerAuth,
  bearerToken,
  type SupabaseBearerAuthOptions,
} from './auth/supabaseBearerAuth.js';
export {
  serviceKeyMiddleware,
  timingSafeEqualStr,
  hasValidServiceKey,
  serviceKeyFrom,
  type ServiceKeyOptions,
} from './auth/serviceKey.js';
export {
  authOrServiceKey,
  type AuthOrServiceKeyOptions,
} from './auth/authOrServiceKey.js';

// ── Supabase ────────────────────────────────────────────────────────────
export {
  createServiceRoleClient,
  installWebSocketPolyfill,
  resetWebSocketPolyfillCache,
  type ServiceRoleClientOptions,
  type WsPolyfillResult,
} from './supabase/client.js';

// ── Errors + envelope ───────────────────────────────────────────────────
export {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  isAppError,
} from './http/errors.js';
export {
  errorKit,
  errorHandler,
  notFoundHandler,
  sendSuccess,
  sendError,
  ok,
  fail,
  type Envelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
  type ErrorHandlerOptions,
} from './http/envelope.js';

// ── CORS ────────────────────────────────────────────────────────────────
export {
  corsAllowlist,
  corsMiddleware,
  type CorsAllowlist,
  type CorsAllowlistOptions,
  type CorsMiddlewareOptions,
  type EnvLike,
} from './http/cors.js';

// ── Rate limiting ───────────────────────────────────────────────────────
export {
  rateLimit,
  clientIp,
  type RateLimitOptions,
  type RateLimitHandler,
} from './http/rateLimit.js';

// ── Filesystem ──────────────────────────────────────────────────────────
export { resolveWithin, resolveWithinOrThrow } from './fs/resolveWithin.js';
