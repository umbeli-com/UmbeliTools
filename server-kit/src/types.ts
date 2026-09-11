/**
 * Shared types + the Express request augmentation.
 *
 * The Supabase shapes below are STRUCTURAL on purpose: server-kit never imports
 * `@supabase/supabase-js`, not even for types. A real `SupabaseClient` satisfies
 * `SupabaseAuthCapableClient` structurally, so callers pass theirs unchanged —
 * and a backend that only wants the error envelope or the rate limiter does not
 * need supabase-js installed to typecheck against this package.
 */

/** The subset of a Supabase `User` this kit reads. A real `User` satisfies it. */
export interface SupabaseAuthUser {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

/** The subset of `SupabaseClient` needed to verify a bearer token. */
export interface SupabaseAuthCapableClient {
  auth: {
    getUser(jwt?: string): Promise<{
      data: { user: SupabaseAuthUser | null };
      error: { message: string } | null;
    }>;
  };
}

/**
 * Loose shape of the client `createServiceRoleClient()` returns when no type
 * argument is given. Enough to feed `supabaseBearerAuth()` and to run queries
 * untyped; pass `createServiceRoleClient<SupabaseClient>({...})` for the real
 * generated types.
 */
export interface SupabaseServiceClient extends SupabaseAuthCapableClient {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): any;
  storage: any;
}

/**
 * Request augmentation.
 *
 * Deliberately narrow. `req.user` is NOT augmented here: Webum, Profilum and
 * the Manager each already declare it with their own app-user type, and a
 * second declaration with a different type is a hard TypeScript error in the
 * consuming build. `userId` is declared as `string | undefined` — identical to
 * the declaration those apps already carry, so the merge is a no-op for them.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Supabase `auth.users.id` of the caller, once a bearer token verified. */
      userId?: string;
      /** True when the caller authenticated with the inter-service key. */
      isService?: boolean;
      /** The raw Supabase user, under a name no app in the suite already uses. */
      authUser?: SupabaseAuthUser;
    }
  }
}

export {};
