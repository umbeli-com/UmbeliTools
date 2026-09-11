/**
 * Service-role Supabase client, with the Node-20 WebSocket polyfill.
 *
 * THE bug this exists for: `@supabase/supabase-js` (via realtime-js) needs a
 * global `WebSocket` at `createClient()` time. Node 20 has none, so on
 * `node:20-alpine` — which is what every container in the suite runs —
 * `createClient()` throws AT BOOT and the API crash-loops behind a deploy that
 * reported success. The Manager, Webum, Profilum, Socialum and Monitorum each
 * carry their own copy of the same six-line polyfill; this is that fix, once.
 *
 * The polyfill runs BEFORE `createClient` is even resolved, and `ws` is an
 * OPTIONAL peer: a backend that never touches realtime keeps working (and gets
 * one warning) instead of failing to start over a dependency it does not use.
 */

import {
  interopDefault,
  loadOptionalModule,
  loadRequiredModule,
} from '../internal/lazy-require.js';
import type { SupabaseServiceClient } from '../types.js';

export type WsPolyfillResult = 'native' | 'installed' | 'unavailable';

let polyfillResult: WsPolyfillResult | null = null;

/**
 * Install `ws` as `globalThis.WebSocket` when the runtime has none.
 *
 * Idempotent, and a no-op on Node >= 22 (native WebSocket). Safe to call from
 * an app's own bootstrap before its own `createClient()`.
 */
export function installWebSocketPolyfill(): WsPolyfillResult {
  if (polyfillResult) return polyfillResult;

  const g = globalThis as { WebSocket?: unknown };
  if (typeof g.WebSocket !== 'undefined') {
    polyfillResult = 'native';
    return polyfillResult;
  }

  const ws = loadOptionalModule<unknown>('ws');
  if (!ws) {
    console.warn(
      '[server-kit] Node has no global WebSocket and the optional peer "ws" is not installed. ' +
        '@supabase/supabase-js will throw at createClient() on Node < 22 — run: npm install ws',
    );
    polyfillResult = 'unavailable';
    return polyfillResult;
  }

  // `require('ws')` is the WebSocket class itself; an interop copy nests it.
  const ctor =
    (ws as { WebSocket?: unknown }).WebSocket ?? interopDefault<unknown>(ws);
  g.WebSocket = ctor;
  polyfillResult = 'installed';
  return polyfillResult;
}

/** Test seam: forget the memoised result so the polyfill can be re-evaluated. */
export function resetWebSocketPolyfillCache(): void {
  polyfillResult = null;
}

export interface ServiceRoleClientOptions {
  /** `SUPABASE_URL`. */
  url: string | undefined;
  /** `SUPABASE_SERVICE_ROLE_KEY` (or an `sb_secret_…` key after rotation). */
  key: string | undefined;
  /** Postgres schema. Default `public`. */
  schema?: string;
  /** Merged over the defaults, for anything this signature does not cover. */
  options?: Record<string, unknown>;
}

type CreateClientFn = (
  url: string,
  key: string,
  options?: Record<string, unknown>,
) => unknown;

/**
 * Build a server-side Supabase client.
 *
 * `persistSession: false` + `autoRefreshToken: false` because a backend has no
 * browser storage to persist into and no session to refresh: leaving them on
 * makes supabase-js keep a timer alive that holds the event loop open and
 * writes a session file into the container.
 *
 * Pass the real type for full typing:
 *   `createServiceRoleClient<SupabaseClient>({ url, key })`
 */
export function createServiceRoleClient<TClient = SupabaseServiceClient>(
  opts: ServiceRoleClientOptions,
): TClient {
  const { url, key, schema = 'public', options } = opts;

  if (!url) throw new Error('[server-kit] createServiceRoleClient: `url` is required (SUPABASE_URL)');
  if (!key) {
    throw new Error(
      '[server-kit] createServiceRoleClient: `key` is required (SUPABASE_SERVICE_ROLE_KEY)',
    );
  }

  // MUST happen before createClient is called — that is the whole point.
  installWebSocketPolyfill();

  const mod = loadRequiredModule<{ createClient?: CreateClientFn }>(
    '@supabase/supabase-js',
    'build a Supabase client',
  );
  const createClient =
    mod.createClient ??
    (interopDefault<{ createClient?: CreateClientFn }>(mod).createClient as CreateClientFn | undefined);
  if (typeof createClient !== 'function') {
    throw new Error('[server-kit] "@supabase/supabase-js" did not export createClient');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
    ...options,
  }) as TClient;
}
