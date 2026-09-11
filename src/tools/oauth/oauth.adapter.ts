import crypto from 'crypto';
import { BaseAdapter } from '../../lib/baseAdapter';
import { AdapterError } from '../../lib/errors';
import { PROVIDERS } from './providers';
import type { ProviderSpec } from './providers';
import type {
  OAuthAuthorizeUrlInput,
  OAuthAuthorizeUrlResult,
  OAuthCredentials,
  OAuthExchangeCodeInput,
  OAuthProfileResult,
  OAuthProvider,
  OAuthRefreshInput,
  OAuthRefreshResult,
  OAuthTokenResult,
} from './types';

/** Refresh this many ms before the access token actually expires. */
export const REFRESH_SAFETY_WINDOW_MS = 2 * 60 * 1000;

const http = new BaseAdapter({ timeout: 20000 });

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  refresh_expires_in?: number | string;
  refresh_token_expires_in?: number | string;
  scope?: string | string[];
  token_type?: string;
  id_token?: string;
  open_id?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function base64Url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generatePkce() {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' as const };
}

/**
 * Several providers answer HTTP 200 with an error payload (GitHub, Meta, TikTok, X).
 * TikTok also ships `error: { code: "ok" }` on SUCCESS, so "an error key exists" is not enough.
 */
function extractError(data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  if (Array.isArray(data.errors) && data.errors.length) {
    const first = data.errors[0];
    return first?.message || first?.detail || first?.title || 'provider returned errors';
  }

  const err = data.error;
  if (err === undefined || err === null || err === '') return null;

  if (typeof err === 'string') {
    if (err === 'ok') return null;
    return (data.error_description as string) || err;
  }

  if (typeof err === 'object') {
    const code = (err as any).code ?? (err as any).type;
    if (code === 'ok' || code === 0 || code === '0') return null;
    return (err as any).message || (err as any).error_user_msg || (data.error_description as string) || String(code ?? 'unknown provider error');
  }

  return null;
}

/**
 * Credentials must not ride out of here inside an error string.
 *
 * `AdapterError.message` is `"<METHOD> <full url> failed with status <n>"`, and Meta's
 * token endpoint is a GET — so the client secret, the authorization code and the access
 * token all sit in that query string. When the provider answers with an empty body the
 * old code fell through to `err.message` and `sendError` echoed the secret straight back
 * to the caller (and into whatever the caller logs). Every message this module produces
 * now passes through here first.
 */
const SENSITIVE_QUERY_PARAM =
  /\b(client_secret|client_key|client_id|code|code_verifier|refresh_token|access_token|fb_exchange_token|id_token|assertion)=([^&\s"'<>]+)/gi;

export function redactSecrets(text: string): string {
  return text.replace(SENSITIVE_QUERY_PARAM, (_match, key: string) => `${key}=[redacted]`);
}

/** The one constructor for every error this module throws — nothing skips the redaction. */
function providerError(message: string): Error {
  return new Error(redactSecrets(message));
}

function toMessage(label: string, err: unknown): Error {
  if (err instanceof AdapterError) {
    const body: any = err.body;
    const detail =
      (typeof body === 'string' && body.slice(0, 400)) ||
      body?.error_description ||
      body?.error?.message ||
      (typeof body?.error === 'string' ? body.error : null) ||
      body?.message ||
      err.message;
    return providerError(`${label} (${err.status ?? 'network'}): ${detail}`);
  }
  if (err instanceof Error) return providerError(err.message);
  return providerError(String(err));
}

function normaliseScope(scope: string | string[] | undefined): string | null {
  if (!scope) return null;
  return Array.isArray(scope) ? scope.join(' ') : String(scope);
}

function toSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function expiryIso(expiresIn: number | null, fallback: number | null): string | null {
  const seconds = expiresIn ?? fallback;
  if (seconds === null || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function resolveScopes(spec: ProviderSpec, requested: string[] | undefined, offlineAccess: boolean): string[] {
  const base = requested?.length ? [...requested] : [...spec.defaultScopes];
  if (offlineAccess && spec.offline?.scopes) {
    for (const s of spec.offline.scopes) if (!base.includes(s)) base.push(s);
  }
  return base;
}

function toTokenResult(provider: OAuthProvider, spec: ProviderSpec, data: RawTokenResponse): OAuthTokenResult {
  const expiresIn = toSeconds(data.expires_in);
  const refreshExpiresIn = toSeconds(data.refresh_expires_in ?? data.refresh_token_expires_in);
  return {
    provider,
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    expiresAt: expiryIso(expiresIn, spec.defaultExpiresIn),
    expiresIn,
    scope: normaliseScope(data.scope),
    tokenType: data.token_type ? String(data.token_type) : null,
    idToken: data.id_token ? String(data.id_token) : null,
    refreshTokenExpiresAt: refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString() : null,
    providerAccountId: data.open_id ? String(data.open_id) : null,
    rotatesRefreshToken: spec.rotatesRefreshToken,
  };
}

/**
 * One token-endpoint call for every provider. Retries are DISABLED on purpose:
 * authorization codes are single-use and rotating refresh tokens (X, TikTok, Microsoft,
 * GitHub Apps) are burned by the first attempt, so a blind retry can lock a user out.
 */
async function tokenRequest(
  spec: ProviderSpec,
  credentials: OAuthCredentials,
  params: Record<string, string | undefined>,
): Promise<RawTokenResponse> {
  const url = spec.tokenUrl({ credentials });
  const headers: Record<string, string> = { Accept: 'application/json', ...spec.tokenHeaders };

  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') payload[k] = v;
  }

  const useBasic = spec.tokenAuth === 'basic-preferred' && !!credentials.clientSecret;
  if (useBasic) {
    headers.Authorization = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`;
  } else {
    payload[spec.clientIdParam] = credentials.clientId;
    if (credentials.clientSecret) payload[spec.clientSecretParam] = credentials.clientSecret;
  }

  let data: any;
  try {
    if (spec.tokenMethod === 'GET') {
      ({ data } = await http.request('GET', url, { query: payload, headers, retries: 0 }));
    } else {
      const body = new URLSearchParams(payload);
      ({ data } = await http.request('POST', url, { body, json: false, headers, retries: 0 }));
    }
  } catch (err) {
    throw toMessage(`${spec.label} token request failed`, err);
  }

  const message = extractError(data);
  if (message) throw providerError(`${spec.label} token request failed: ${message}`);
  if (!data?.access_token) {
    throw providerError(`${spec.label} token request returned no access_token`);
  }
  return data as RawTokenResponse;
}

// ---------------------------------------------------------------------------
// authorize-url
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(input: OAuthAuthorizeUrlInput): OAuthAuthorizeUrlResult {
  const spec = PROVIDERS[input.provider];
  const credentials = input.credentials;
  const offlineAccess = input.offlineAccess !== false;
  const scopes = resolveScopes(spec, input.scopes, offlineAccess);

  const state =
    input.state ||
    (input.stateData ? base64Url(Buffer.from(JSON.stringify(input.stateData), 'utf-8')) : crypto.randomBytes(16).toString('hex'));

  const wantsPkce = input.usePkce !== false;
  const usePkce = spec.pkce === 'required' || (spec.pkce === 'supported' && wantsPkce);
  const pkce = usePkce ? generatePkce() : null;

  const query = new URLSearchParams({
    response_type: 'code',
    [spec.clientIdParam]: credentials.clientId,
    redirect_uri: input.redirectUri,
    scope: scopes.join(spec.scopeSeparator),
    state,
  });

  for (const [k, v] of Object.entries(spec.extraAuthorizeParams)) query.set(k, v);
  if (offlineAccess && spec.offline?.params) {
    for (const [k, v] of Object.entries(spec.offline.params)) query.set(k, v);
  }
  if (spec.defaultPrompt) query.set('prompt', spec.defaultPrompt);
  if (input.prompt) query.set('prompt', input.prompt);
  if (input.loginHint) query.set('login_hint', input.loginHint);
  if (pkce) {
    query.set('code_challenge', pkce.codeChallenge);
    query.set('code_challenge_method', pkce.codeChallengeMethod);
  }
  for (const [k, v] of Object.entries(input.extraParams || {})) query.set(k, v);

  return {
    provider: input.provider,
    url: `${spec.authorizeUrl({ credentials })}?${query.toString()}`,
    state,
    codeVerifier: pkce?.codeVerifier ?? null,
    codeChallenge: pkce?.codeChallenge ?? null,
    codeChallengeMethod: pkce ? 'S256' : null,
    scopes,
    offlineAccess,
  };
}

// ---------------------------------------------------------------------------
// exchange-code
// ---------------------------------------------------------------------------

export async function exchangeCode(input: OAuthExchangeCodeInput): Promise<OAuthTokenResult> {
  const spec = PROVIDERS[input.provider];
  const { credentials } = input;

  const params: Record<string, string | undefined> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: spec.redirectUriOnExchange ? input.redirectUri : undefined,
    code_verifier: spec.pkce === 'unsupported' ? undefined : input.codeVerifier,
  };
  if (spec.scopeOnTokenRequest && input.scopes?.length) {
    params.scope = input.scopes.join(spec.scopeSeparator);
  }

  const data = await tokenRequest(spec, credentials, params);
  const result = toTokenResult(input.provider, spec, data);

  // Meta issues a short-lived token; upgrade it to the ~60-day long-lived one straight away.
  if (spec.refresh === 'fb-exchange') {
    const longLived = await fbExchange(spec, credentials, result.accessToken);
    return { ...toTokenResult(input.provider, spec, longLived), scope: result.scope ?? normaliseScope(longLived.scope) };
  }

  return result;
}

async function fbExchange(spec: ProviderSpec, credentials: OAuthCredentials, accessToken: string): Promise<RawTokenResponse> {
  return tokenRequest(spec, credentials, {
    grant_type: 'fb_exchange_token',
    fb_exchange_token: accessToken,
  });
}

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

function msUntilExpiry(expiresAt: string | number | undefined): number | null {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;
  const ms = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt));
  if (!Number.isFinite(ms)) return null;
  return ms - Date.now();
}

/** True when the caller's current access token still has more than the safety window left. */
export function isStillValid(expiresAt: string | number | undefined): boolean {
  const remaining = msUntilExpiry(expiresAt);
  return remaining !== null && remaining > REFRESH_SAFETY_WINDOW_MS;
}

export async function refreshAccessToken(input: OAuthRefreshInput): Promise<OAuthRefreshResult> {
  const spec = PROVIDERS[input.provider];
  const { credentials } = input;

  // 2-minute safety window: only skip when we can hand back a token that is definitely usable.
  if (!input.force && input.accessToken && isStillValid(input.expiresAt)) {
    const remaining = msUntilExpiry(input.expiresAt) ?? 0;
    return {
      provider: input.provider,
      refreshed: false,
      skippedReason: 'still-valid',
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      refreshTokenRotated: false,
      expiresAt: typeof input.expiresAt === 'number' ? new Date(input.expiresAt).toISOString() : (input.expiresAt as string) ?? null,
      expiresIn: Math.floor(remaining / 1000),
      scope: null,
      tokenType: null,
      refreshTokenExpiresAt: null,
      rotatesRefreshToken: spec.rotatesRefreshToken,
    };
  }

  let data: RawTokenResponse;

  if (spec.refresh === 'fb-exchange') {
    // The route rejects this first; the guard keeps a direct adapter caller from
    // sending `fb_exchange_token=undefined` and getting an opaque provider error back.
    if (!input.accessToken) {
      throw providerError(`${spec.label} refresh needs the current accessToken (there is no refresh token)`);
    }
    data = await fbExchange(spec, credentials, input.accessToken);
  } else {
    const params: Record<string, string | undefined> = {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    };
    if (spec.scopeOnTokenRequest && input.scopes?.length) {
      params.scope = input.scopes.join(spec.scopeSeparator);
    }
    data = await tokenRequest(spec, credentials, params);
  }

  const token = toTokenResult(input.provider, spec, data);
  const returned = token.refreshToken;
  const rotated = !!returned && !!input.refreshToken && returned !== input.refreshToken;

  return {
    provider: input.provider,
    refreshed: true,
    skippedReason: null,
    accessToken: token.accessToken,
    // Persist this: the rotated token when the provider issued one, otherwise the caller's own.
    refreshToken: returned ?? input.refreshToken ?? null,
    refreshTokenRotated: rotated,
    expiresAt: token.expiresAt,
    expiresIn: token.expiresIn,
    scope: token.scope,
    tokenType: token.tokenType,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    rotatesRefreshToken: spec.rotatesRefreshToken,
  };
}

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

export async function fetchProfile(
  provider: OAuthProvider,
  accessToken: string,
  credentials?: OAuthCredentials,
): Promise<OAuthProfileResult> {
  const spec = PROVIDERS[provider];
  const url = spec.profileUrl({ credentials: credentials || { clientId: '' } });

  let data: any;
  try {
    // retries: 1, not the adapter default of 3. Three retries of a 20 s request with
    // exponential backoff is ~87 s of hold time on a route with no cap of its own —
    // long past the point where the caller and the proxy in front of us have given up.
    ({ data } = await http.request('GET', url, {
      query: spec.profileQuery,
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...spec.profileHeaders },
      retries: 1,
    }));
  } catch (err) {
    throw toMessage(`${spec.label} profile request failed`, err);
  }

  const message = extractError(data);
  const parsed = spec.parseProfile(data);

  // X (and TikTok) answer HTTP 200 with BOTH a payload and a partial `errors[]` when one
  // requested field is unavailable. An identified account means the call succeeded, so only
  // fail when the error left us with nothing to return.
  if (message && !parsed.id) throw providerError(`${spec.label} profile request failed: ${message}`);

  // GitHub hides private emails on /user — fall back to /user/emails when the scope allows it.
  if (provider === 'github' && !parsed.email) {
    parsed.email = await githubPrimaryEmail(accessToken);
  }

  return { provider, ...parsed, raw: data };
}

async function githubPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const { data } = await http.request('GET', 'https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      retries: 0,
    });
    if (!Array.isArray(data)) return null;
    const primary = data.find((e: any) => e?.primary && e?.verified) || data.find((e: any) => e?.verified) || data[0];
    return primary?.email ? String(primary.email) : null;
  } catch {
    return null; // user:email scope not granted — not fatal
  }
}
