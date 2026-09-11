import { UmbeliToolsCore } from '../client.js';

export type OAuthProvider = 'google' | 'microsoft' | 'github' | 'meta' | 'linkedin' | 'tiktok' | 'x';

/**
 * Per-request OAuth app credentials — the service never reads them from its own env.
 * `clientSecret` is optional only for microsoft/x public PKCE clients.
 */
export interface OAuthCredentials {
  clientId: string;
  clientSecret?: string;
  /** microsoft only — Azure tenant ("common" by default). */
  tenantId?: string;
  /** meta only — Graph API version (default `v23.0`). */
  apiVersion?: string;
}

export interface OAuthAuthorizeUrlInput {
  provider: OAuthProvider;
  credentials: OAuthCredentials;
  redirectUri: string;
  /** Replaces the provider default scopes entirely. */
  scopes?: string[];
  state?: string;
  /**
   * JSON base64url-encoded into `state` when `state` is omitted. That is encoding, not
   * signing or encryption — the value is readable (and editable) in the user's browser,
   * so keep secrets and trusted claims out of it.
   */
  stateData?: Record<string, unknown>;
  /** Ask for a refresh / long-lived token where supported. Default `true`. */
  offlineAccess?: boolean;
  /** Ignored where PKCE is required (x, tiktok web) or unsupported (github, linkedin). */
  usePkce?: boolean;
  loginHint?: string;
  prompt?: string;
  extraParams?: Record<string, string>;
}

export interface OAuthAuthorizeUrlResult {
  provider: OAuthProvider;
  url: string;
  /** Persist this and compare it on the callback. */
  state: string;
  /**
   * PERSIST THIS against `state` — `exchangeCode` needs it back.
   * Null when PKCE was not used (github, linkedin, or `usePkce: false`).
   */
  codeVerifier: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | null;
  scopes: string[];
  offlineAccess: boolean;
}

export interface OAuthExchangeCodeInput {
  provider: OAuthProvider;
  credentials: OAuthCredentials;
  code: string;
  redirectUri: string;
  /** Required for `x` and for tiktok web apps. */
  codeVerifier?: string;
  scopes?: string[];
}

export interface OAuthTokenResult {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601, or null for non-expiring tokens (github OAuth Apps). */
  expiresAt: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
  idToken: string | null;
  refreshTokenExpiresAt: string | null;
  /** tiktok `open_id` when present. */
  providerAccountId: string | null;
  /** True when this provider rotates refresh tokens on every refresh. */
  rotatesRefreshToken: boolean;
}

export interface OAuthRefreshInput {
  provider: OAuthProvider;
  credentials: OAuthCredentials;
  /** Required for every provider except `meta`. */
  refreshToken?: string;
  /** Required for `meta`; elsewhere it enables the 2-minute expiry safety window. */
  accessToken?: string;
  /** ISO 8601 or epoch ms expiry of the current access token. */
  expiresAt?: string | number;
  /** Refresh even when the current token is still comfortably valid. */
  force?: boolean;
  scopes?: string[];
}

export interface OAuthRefreshResult {
  provider: OAuthProvider;
  /** False when the safety window short-circuited the call. */
  refreshed: boolean;
  skippedReason: 'still-valid' | null;
  accessToken: string;
  /** The refresh token to persist — the rotated one when the provider issued a new one. */
  refreshToken: string | null;
  /** True when the provider returned a DIFFERENT refresh token: persist it or the user is locked out. */
  refreshTokenRotated: boolean;
  expiresAt: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
  refreshTokenExpiresAt: string | null;
  rotatesRefreshToken: boolean;
}

export interface OAuthProfileInput {
  provider: OAuthProvider;
  accessToken: string;
  /** Only meaningful for `meta` (apiVersion); no secret is used by this action. */
  credentials?: OAuthCredentials;
}

export interface OAuthProfileResult {
  provider: OAuthProvider;
  id: string | null;
  /** Always null for tiktok and x — neither exposes an email. */
  email: string | null;
  name: string | null;
  /** Always null for microsoft (Graph serves the photo as binary, not a URL). */
  avatar: string | null;
  username: string | null;
  /** Untouched provider payload. */
  raw: unknown;
}

/**
 * OAuth 2.0 for google | microsoft | github | meta | linkedin | tiktok | x.
 *
 * @example
 * ```ts
 * const { url, state, codeVerifier } = await tools.oauth.authorizeUrl({
 *   provider: 'google',
 *   credentials: { clientId, clientSecret },
 *   redirectUri: 'https://app.umbeli.com/oauth/google/callback',
 *   scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'],
 * });
 * // persist { state -> codeVerifier } before redirecting
 *
 * const tokens = await tools.oauth.exchangeCode({
 *   provider: 'google', credentials, code, redirectUri, codeVerifier,
 * });
 *
 * const fresh = await tools.oauth.refresh({
 *   provider: 'google', credentials,
 *   refreshToken: stored.refreshToken,
 *   accessToken: stored.accessToken,
 *   expiresAt: stored.expiresAt,
 * });
 * if (fresh.refreshTokenRotated) await persist(fresh.refreshToken); // or the user is locked out
 * ```
 */
export class OAuthTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Build the consent URL. Returns the generated `state` and the PKCE `codeVerifier` to persist. */
  authorizeUrl(input: OAuthAuthorizeUrlInput) {
    return this.core.request<OAuthAuthorizeUrlResult>('oauth', 'authorize-url', input);
  }

  /** Exchange the callback `code` (plus the PKCE verifier) for tokens. */
  exchangeCode(input: OAuthExchangeCodeInput) {
    return this.core.request<OAuthTokenResult>('oauth', 'exchange-code', input);
  }

  /**
   * Refresh an access token. Pass `accessToken` + `expiresAt` and the call is skipped
   * while more than 2 minutes of life remain (`refreshed: false`).
   * ALWAYS persist `refreshToken` when `refreshTokenRotated` is true.
   */
  refresh(input: OAuthRefreshInput) {
    return this.core.request<OAuthRefreshResult>('oauth', 'refresh', input);
  }

  /** Normalised account behind an access token. */
  profile(input: OAuthProfileInput) {
    return this.core.request<OAuthProfileResult>('oauth', 'profile', input);
  }
}
