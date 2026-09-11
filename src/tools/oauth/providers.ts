import type { OAuthCredentials, OAuthProfileResult, OAuthProvider } from './types';

/**
 * THE TABLE.
 *
 * Every endpoint, parameter name and quirk of every provider lives here and nowhere else.
 * Adding a provider = adding one entry below. `oauth.adapter.ts` contains no per-provider
 * branching beyond what it reads off this table.
 */

export type PkceSupport = 'required' | 'supported' | 'unsupported';
export type RefreshKind = 'refresh_token' | 'fb-exchange' | 'none';

export interface ProviderCtx {
  credentials: OAuthCredentials;
}

export interface ProviderSpec {
  label: string;
  authorizeUrl: (ctx: ProviderCtx) => string;
  tokenUrl: (ctx: ProviderCtx) => string;
  profileUrl: (ctx: ProviderCtx) => string;

  /** Param name carrying the client id — TikTok calls it `client_key`. */
  clientIdParam: string;
  clientSecretParam: string;
  /** ' ' for OIDC-style providers, ',' for Meta and TikTok. */
  scopeSeparator: string;
  defaultScopes: string[];

  pkce: PkceSupport;
  /** How to ask for long-lived / refreshable access. */
  offline: { params?: Record<string, string>; scopes?: string[] } | null;
  extraAuthorizeParams: Record<string, string>;
  /** Default `prompt` value, overridable per request. */
  defaultPrompt?: string;

  /** `basic-preferred`: HTTP Basic when a client secret exists (X), body params otherwise. */
  tokenAuth: 'body' | 'basic-preferred';
  tokenMethod: 'GET' | 'POST';
  tokenHeaders: Record<string, string>;
  /** Providers that want `scope` echoed back on token/refresh calls (microsoft). */
  scopeOnTokenRequest: boolean;
  /** False where a public PKCE client is legitimate (microsoft, x). */
  clientSecretRequired: boolean;
  /** Whether `redirect_uri` must accompany the code exchange. */
  redirectUriOnExchange: boolean;

  refresh: RefreshKind;
  /** Provider rotates (invalidates) the refresh token on every refresh — persist the new one or lock the user out. */
  rotatesRefreshToken: boolean;
  /** Fallback lifetime in seconds when the token response omits `expires_in`. Null = non-expiring. */
  defaultExpiresIn: number | null;

  profileHeaders: Record<string, string>;
  profileQuery: Record<string, string>;
  parseProfile: (raw: any) => Omit<OAuthProfileResult, 'provider' | 'raw'>;

  /** Free-text quirks surfaced in GET /api/tools so callers do not have to read this file. */
  notes: string;
}

/**
 * `tenantId` and `apiVersion` are the only caller-supplied values that reach a provider
 * URL as a PATH SEGMENT instead of an encoded query value, so they are pattern-checked
 * before interpolation and fall back to the default when they do not match. Without this
 * a caller could bend the token/profile request onto another path of the provider host
 * (`apiVersion: "v23.0/../../x?y="`), which is exactly the kind of caller-controlled URL
 * this service must never build.
 */
export const MS_TENANT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
export const META_API_VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}$/;

const metaVersion = (ctx: ProviderCtx) => {
  const version = ctx.credentials.apiVersion?.trim();
  return version && META_API_VERSION_PATTERN.test(version) ? version : 'v23.0';
};
const msTenant = (ctx: ProviderCtx) => {
  const tenant = ctx.credentials.tenantId?.trim();
  return tenant && MS_TENANT_PATTERN.test(tenant) ? tenant : 'common';
};

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Null when the credentials object is usable, otherwise the message to answer 400 with.
 * Presence of `clientId` (and of `clientSecret` where the provider requires it) is the
 * route's job; this checks the SHAPE of whatever was supplied.
 */
export function validateCredentials(credentials: unknown): string | null {
  if (credentials === undefined || credentials === null) return null;
  if (typeof credentials !== 'object' || Array.isArray(credentials)) return 'credentials must be an object';

  const c = credentials as Record<string, unknown>;
  if (c.clientId !== undefined && !nonEmptyString(c.clientId)) return 'credentials.clientId must be a non-empty string';
  if (c.clientSecret !== undefined && c.clientSecret !== null && !nonEmptyString(c.clientSecret)) {
    return 'credentials.clientSecret must be a non-empty string';
  }
  if (c.tenantId !== undefined && c.tenantId !== null) {
    if (!nonEmptyString(c.tenantId) || !MS_TENANT_PATTERN.test(c.tenantId.trim())) {
      return 'credentials.tenantId must be "common", "organizations", "consumers", a tenant GUID or a verified domain (letters, digits, dot, dash, underscore)';
    }
  }
  if (c.apiVersion !== undefined && c.apiVersion !== null) {
    if (!nonEmptyString(c.apiVersion) || !META_API_VERSION_PATTERN.test(c.apiVersion.trim())) {
      return 'credentials.apiVersion must look like "v23.0"';
    }
  }
  return null;
}

const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

export const PROVIDERS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    label: 'Google',
    authorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    profileUrl: () => 'https://openidconnect.googleapis.com/v1/userinfo',
    clientIdParam: 'client_id',
    clientSecretParam: 'client_secret',
    scopeSeparator: ' ',
    defaultScopes: ['openid', 'email', 'profile'],
    pkce: 'supported',
    offline: { params: { access_type: 'offline', prompt: 'consent' } },
    extraAuthorizeParams: { include_granted_scopes: 'true' },
    tokenAuth: 'body',
    tokenMethod: 'POST',
    tokenHeaders: {},
    scopeOnTokenRequest: false,
    clientSecretRequired: true,
    redirectUriOnExchange: true,
    refresh: 'refresh_token',
    rotatesRefreshToken: false,
    defaultExpiresIn: 3600,
    profileHeaders: {},
    profileQuery: {},
    parseProfile: (raw) => ({
      id: str(raw?.sub),
      email: str(raw?.email),
      name: str(raw?.name) || str(raw?.given_name),
      avatar: str(raw?.picture),
      username: str(raw?.email),
    }),
    notes:
      'A refresh token is only returned on the FIRST consent unless access_type=offline AND prompt=consent are sent (offlineAccess does both). Google normally keeps the same refresh token, but returns a rotated one for some client/consent configurations — always persist `refreshToken` when `refreshTokenRotated` is true. Refresh tokens of apps still in "Testing" publishing status expire after 7 days.',
  },

  microsoft: {
    label: 'Microsoft',
    authorizeUrl: (ctx) => `https://login.microsoftonline.com/${msTenant(ctx)}/oauth2/v2.0/authorize`,
    tokenUrl: (ctx) => `https://login.microsoftonline.com/${msTenant(ctx)}/oauth2/v2.0/token`,
    profileUrl: () => 'https://graph.microsoft.com/v1.0/me',
    clientIdParam: 'client_id',
    clientSecretParam: 'client_secret',
    scopeSeparator: ' ',
    defaultScopes: ['openid', 'profile', 'email', 'User.Read'],
    pkce: 'supported',
    offline: { scopes: ['offline_access'] },
    extraAuthorizeParams: { response_mode: 'query' },
    defaultPrompt: 'select_account',
    tokenAuth: 'body',
    tokenMethod: 'POST',
    tokenHeaders: {},
    scopeOnTokenRequest: true,
    clientSecretRequired: false,
    redirectUriOnExchange: true,
    refresh: 'refresh_token',
    rotatesRefreshToken: true,
    defaultExpiresIn: 3600,
    profileHeaders: {},
    profileQuery: { $select: 'id,displayName,userPrincipalName,mail' },
    parseProfile: (raw) => ({
      id: str(raw?.id),
      email: str(raw?.mail) || str(raw?.userPrincipalName),
      name: str(raw?.displayName),
      avatar: null,
      username: str(raw?.userPrincipalName),
    }),
    notes:
      'Entra ID ROTATES the refresh token on every refresh — persist the returned one. `offline_access` is required for refresh tokens. Single-tenant apps reject personal accounts (AADSTS50194/50020): set credentials.tenantId to "common" and make the app multi-tenant. Graph does not expose an avatar URL (the photo endpoint returns binary), so `avatar` is always null.',
  },

  github: {
    label: 'GitHub',
    authorizeUrl: () => 'https://github.com/login/oauth/authorize',
    tokenUrl: () => 'https://github.com/login/oauth/access_token',
    profileUrl: () => 'https://api.github.com/user',
    clientIdParam: 'client_id',
    clientSecretParam: 'client_secret',
    scopeSeparator: ' ',
    defaultScopes: ['read:user', 'user:email'],
    pkce: 'unsupported',
    offline: null,
    extraAuthorizeParams: {},
    tokenAuth: 'body',
    tokenMethod: 'POST',
    tokenHeaders: { Accept: 'application/json' },
    scopeOnTokenRequest: false,
    clientSecretRequired: true,
    redirectUriOnExchange: true,
    refresh: 'refresh_token',
    rotatesRefreshToken: true,
    defaultExpiresIn: null,
    profileHeaders: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    profileQuery: {},
    parseProfile: (raw) => ({
      id: str(raw?.id),
      email: str(raw?.email),
      name: str(raw?.name) || str(raw?.login),
      avatar: str(raw?.avatar_url),
      username: str(raw?.login),
    }),
    notes:
      'OAuth Apps: tokens never expire, there is NO refresh token, and PKCE is not supported — exchange-code returns expiresAt: null and refreshToken: null. GitHub Apps with "expiring user tokens" enabled do return a refresh token (8h access / 6mo refresh) and rotate it on every refresh; the refresh action targets that case. The token endpoint answers HTTP 200 with an `error` body on failure. `email` is null when the user hides it — the profile action falls back to GET /user/emails (needs the user:email scope).',
  },

  meta: {
    label: 'Meta (Facebook Login)',
    authorizeUrl: (ctx) => `https://www.facebook.com/${metaVersion(ctx)}/dialog/oauth`,
    tokenUrl: (ctx) => `https://graph.facebook.com/${metaVersion(ctx)}/oauth/access_token`,
    profileUrl: (ctx) => `https://graph.facebook.com/${metaVersion(ctx)}/me`,
    clientIdParam: 'client_id',
    clientSecretParam: 'client_secret',
    scopeSeparator: ',',
    defaultScopes: ['public_profile', 'email'],
    pkce: 'supported',
    offline: null,
    extraAuthorizeParams: { return_scopes: 'true' },
    tokenAuth: 'body',
    tokenMethod: 'GET',
    tokenHeaders: {},
    scopeOnTokenRequest: false,
    clientSecretRequired: true,
    redirectUriOnExchange: true,
    refresh: 'fb-exchange',
    rotatesRefreshToken: false,
    defaultExpiresIn: 5184000,
    profileHeaders: {},
    profileQuery: { fields: 'id,name,email,picture{url}' },
    parseProfile: (raw) => ({
      id: str(raw?.id),
      email: str(raw?.email),
      name: str(raw?.name),
      avatar: str(raw?.picture?.data?.url),
      username: str(raw?.name),
    }),
    notes:
      'Meta has NO refresh token. The token endpoint is a GET. exchange-code returns a short-lived token and immediately upgrades it via grant_type=fb_exchange_token to a ~60-day long-lived token. The refresh action re-runs that same exchange, so it needs the CURRENT access token (input.accessToken), not a refresh token; call it before the 60 days elapse or the user must re-consent. Instagram Business Login (instagram.com/oauth/authorize + ig_exchange_token) is a DIFFERENT flow and is not covered by this provider.',
  },

  linkedin: {
    label: 'LinkedIn',
    authorizeUrl: () => 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: () => 'https://www.linkedin.com/oauth/v2/accessToken',
    profileUrl: () => 'https://api.linkedin.com/v2/userinfo',
    clientIdParam: 'client_id',
    clientSecretParam: 'client_secret',
    scopeSeparator: ' ',
    defaultScopes: ['openid', 'profile', 'email'],
    pkce: 'unsupported',
    offline: null,
    extraAuthorizeParams: {},
    tokenAuth: 'body',
    tokenMethod: 'POST',
    tokenHeaders: {},
    scopeOnTokenRequest: false,
    clientSecretRequired: true,
    redirectUriOnExchange: true,
    refresh: 'refresh_token',
    rotatesRefreshToken: true,
    defaultExpiresIn: 5184000,
    profileHeaders: {},
    profileQuery: {},
    parseProfile: (raw) => ({
      id: str(raw?.sub),
      email: str(raw?.email),
      name: str(raw?.name) || [raw?.given_name, raw?.family_name].filter(Boolean).join(' ') || null,
      avatar: str(raw?.picture),
      username: str(raw?.email),
    }),
    notes:
      'PKCE is not supported. Access tokens last ~60 days; refresh tokens are only issued to apps approved for "programmatic refresh tokens" — most apps get refreshToken: null and must re-consent. Organisation scopes (r_organization_admin, w_organization_social) need the Community Management API product. The `raw` profile is the OIDC userinfo payload; organisation ACLs live behind api.linkedin.com/rest/organizationAcls and are not fetched here.',
  },

  tiktok: {
    label: 'TikTok',
    authorizeUrl: () => 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: () => 'https://open.tiktokapis.com/v2/oauth/token/',
    profileUrl: () => 'https://open.tiktokapis.com/v2/user/info/',
    clientIdParam: 'client_key',
    clientSecretParam: 'client_secret',
    scopeSeparator: ',',
    defaultScopes: ['user.info.basic'],
    pkce: 'supported',
    offline: null,
    extraAuthorizeParams: {},
    tokenAuth: 'body',
    tokenMethod: 'POST',
    tokenHeaders: { 'Cache-Control': 'no-cache' },
    scopeOnTokenRequest: false,
    clientSecretRequired: true,
    redirectUriOnExchange: true,
    refresh: 'refresh_token',
    rotatesRefreshToken: true,
    defaultExpiresIn: 86400,
    profileHeaders: {},
    profileQuery: { fields: 'open_id,union_id,avatar_url,avatar_url_100,display_name' },
    parseProfile: (raw) => {
      const user = raw?.data?.user ?? raw?.data ?? raw;
      return {
        id: str(user?.open_id),
        email: null,
        name: str(user?.display_name),
        avatar: str(user?.avatar_url_100) || str(user?.avatar_url),
        username: str(user?.display_name),
      };
    },
    notes:
      'The client id parameter is `client_key`, not `client_id`. PKCE is mandatory for TikTok WEB apps (optional for native), so always pass the codeVerifier back. Refresh tokens ROTATE on every refresh and carry their own expiry (refresh_expires_in, ~365 days) — persist both. TikTok never exposes an email address, so `email` is always null. Errors arrive as HTTP 200 with an `error`/`error_description` body.',
  },

  x: {
    label: 'X (Twitter) OAuth 2.0',
    authorizeUrl: () => 'https://x.com/i/oauth2/authorize',
    tokenUrl: () => 'https://api.x.com/2/oauth2/token',
    profileUrl: () => 'https://api.x.com/2/users/me',
    clientIdParam: 'client_id',
    clientSecretParam: 'client_secret',
    scopeSeparator: ' ',
    defaultScopes: ['tweet.read', 'users.read'],
    pkce: 'required',
    offline: { scopes: ['offline.access'] },
    extraAuthorizeParams: {},
    tokenAuth: 'basic-preferred',
    tokenMethod: 'POST',
    tokenHeaders: {},
    scopeOnTokenRequest: false,
    clientSecretRequired: false,
    redirectUriOnExchange: true,
    refresh: 'refresh_token',
    rotatesRefreshToken: true,
    defaultExpiresIn: 7200,
    profileHeaders: {},
    profileQuery: { 'user.fields': 'id,name,username,profile_image_url' },
    parseProfile: (raw) => {
      const user = raw?.data ?? raw;
      return {
        id: str(user?.id),
        email: null,
        name: str(user?.name),
        avatar: str(user?.profile_image_url),
        username: str(user?.username),
      };
    },
    notes:
      'PKCE is REQUIRED. Confidential clients authenticate the token endpoint with HTTP Basic (client_id:client_secret) and must NOT repeat client_id in the body; public clients send client_id in the body instead — both are handled. The `offline.access` scope is what produces a refresh token, and that refresh token is SINGLE-USE: every refresh returns a new one and invalidates the old, so a lost rotation means full re-consent. X v2 never returns an email address. NOTE: X OAuth 1.0a (still required for v1.1 media upload) is a completely different, HMAC-signed flow and is NOT covered by this tool.',
  },
};

export function getProviderSpec(provider: string): ProviderSpec | null {
  // Own-property lookup ONLY. A plain `PROVIDERS[provider] ?? null` answers a truthy
  // value for inherited keys — `constructor`, `__proto__`, `toString` — and the caller
  // then walks off with a "spec" that has no tokenUrl, turning an unknown provider into
  // a 502 TypeError instead of a 400.
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider)
    ? (PROVIDERS as Record<string, ProviderSpec>)[provider]
    : null;
}
