export type OAuthProvider = 'google' | 'microsoft' | 'github' | 'meta' | 'linkedin' | 'tiktok' | 'x';

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  'google',
  'microsoft',
  'github',
  'meta',
  'linkedin',
  'tiktok',
  'x',
];

/**
 * Per-request OAuth app credentials. Never read from process.env — the caller owns them.
 * `clientSecret` is optional only for providers that accept public PKCE clients (microsoft, x).
 */
export interface OAuthCredentials {
  clientId: string;
  clientSecret?: string;
  /** microsoft only — Azure tenant ("common", "organizations", "consumers" or a GUID). Defaults to "common". */
  tenantId?: string;
  /** meta only — Graph API version override. Defaults to v23.0 (same version as the `social` tool). */
  apiVersion?: string;
}

export interface OAuthAuthorizeUrlInput {
  provider: OAuthProvider;
  credentials: OAuthCredentials;
  redirectUri: string;
  /** Overrides the provider default scopes entirely. */
  scopes?: string[];
  /** Opaque state. Generated (32 hex chars) when omitted. */
  state?: string;
  /**
   * Convenience: JSON + base64url encoded into `state` when `state` is not supplied.
   * base64url is ENCODING, not encryption or signing — the value travels through the
   * user's browser in plain sight, so never put a secret or a trusted claim in it.
   */
  stateData?: Record<string, unknown>;
  /** Ask for a refresh token / long-lived token where the provider supports it. Default true. */
  offlineAccess?: boolean;
  /** Force PKCE off (ignored where the provider requires it). Default true wherever supported. */
  usePkce?: boolean;
  loginHint?: string;
  /** Overrides the provider default `prompt` value (google/microsoft). */
  prompt?: string;
  /** Extra query params merged last — escape hatch for provider-specific flags. */
  extraParams?: Record<string, string>;
}

export interface OAuthExchangeCodeInput {
  provider: OAuthProvider;
  credentials: OAuthCredentials;
  code: string;
  redirectUri: string;
  /** The verifier returned by authorize-url. Required for providers whose PKCE is `required`. */
  codeVerifier?: string;
  /** Only used by providers that echo scope on the token request (microsoft). */
  scopes?: string[];
}

export interface OAuthRefreshInput {
  provider: OAuthProvider;
  credentials: OAuthCredentials;
  /** Required for every provider except `meta` (which re-exchanges the access token instead). */
  refreshToken?: string;
  /** Current access token. Required for `meta`; elsewhere it enables the expiry safety window. */
  accessToken?: string;
  /** When the current access token expires (ISO string or epoch ms). Enables the 2-minute safety window. */
  expiresAt?: string | number;
  /** Refresh even when the current token is still comfortably valid. Default false. */
  force?: boolean;
  scopes?: string[];
}

export interface OAuthProfileInput {
  provider: OAuthProvider;
  credentials?: OAuthCredentials;
  accessToken: string;
}

export interface OAuthAuthorizeUrlResult {
  provider: OAuthProvider;
  url: string;
  /** The exact state string sent to the provider — persist it and compare on callback. */
  state: string;
  /** PERSIST THIS against `state`; exchange-code needs it back. Null when PKCE is not used. */
  codeVerifier: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | null;
  scopes: string[];
  offlineAccess: boolean;
}

export interface OAuthTokenResult {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601, or null when the provider issues non-expiring tokens (github OAuth Apps). */
  expiresAt: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
  idToken: string | null;
  refreshTokenExpiresAt: string | null;
  /** tiktok `open_id`, when the token response carries an account id. */
  providerAccountId: string | null;
  /** True when this provider rotates the refresh token on every refresh — persist every new one. */
  rotatesRefreshToken: boolean;
}

export interface OAuthRefreshResult {
  provider: OAuthProvider;
  /** False when the safety window short-circuited the call — the token was still valid. */
  refreshed: boolean;
  skippedReason: 'still-valid' | null;
  accessToken: string;
  /** The token to persist: the rotated one when the provider returned a new one, else the one you sent. */
  refreshToken: string | null;
  /** True when the provider handed back a DIFFERENT refresh token — you must persist it. */
  refreshTokenRotated: boolean;
  expiresAt: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
  refreshTokenExpiresAt: string | null;
  rotatesRefreshToken: boolean;
}

export interface OAuthProfileResult {
  provider: OAuthProvider;
  id: string | null;
  email: string | null;
  name: string | null;
  avatar: string | null;
  username: string | null;
  /** Untouched provider payload — LinkedIn orgs, TikTok union_id, GitHub plan, etc. */
  raw: unknown;
}
