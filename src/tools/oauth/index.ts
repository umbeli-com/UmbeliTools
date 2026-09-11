import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { buildAuthorizeUrl, exchangeCode, fetchProfile, refreshAccessToken } from './oauth.adapter';
import { PROVIDERS, getProviderSpec, validateCredentials } from './providers';
import type { ProviderSpec } from './providers';
import { OAUTH_PROVIDERS } from './types';
import type {
  OAuthAuthorizeUrlInput,
  OAuthExchangeCodeInput,
  OAuthProfileInput,
  OAuthProvider,
  OAuthRefreshInput,
} from './types';

const router = Router();

type Fail = { code: string; message: string };

/** Resolves the provider or produces the 400 payload to send back. */
function resolveProvider(provider: unknown): { spec: ProviderSpec; name: OAuthProvider } | Fail {
  if (!provider || typeof provider !== 'string') {
    return { code: 'MISSING_FIELDS', message: `provider is required (one of: ${OAUTH_PROVIDERS.join(', ')})` };
  }
  const spec = getProviderSpec(provider);
  if (!spec) {
    return { code: 'INVALID_PROVIDER', message: `Unknown provider "${provider}". Supported: ${OAUTH_PROVIDERS.join(', ')}` };
  }
  return { spec, name: provider as OAuthProvider };
}

function isFail(v: unknown): v is Fail {
  return !!v && typeof (v as Fail).code === 'string';
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Null when the redirect URI is usable, else the 400 message.
 *
 * Custom schemes (`com.myapp://callback`) are legitimate for native clients, so this only
 * demands a parseable absolute URI and refuses the script-bearing schemes — the value ends
 * up in a URL a browser is sent to.
 */
function redirectUriIssue(value: unknown): string | null {
  if (!isStr(value)) return 'redirectUri is required';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'redirectUri must be an absolute URI (e.g. https://app.umbeli.com/oauth/google/callback)';
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === 'javascript:' || scheme === 'data:' || scheme === 'vbscript:' || scheme === 'file:') {
    return `redirectUri scheme "${scheme}" is not allowed`;
  }
  return null;
}

/**
 * Shape checks shared by every route: the credentials object itself (types, and the two
 * fields that reach a provider URL as a path segment), plus the presence of clientId.
 * Returns the 400 payload to answer with, or null.
 */
function credentialsIssue(credentials: unknown, spec: ProviderSpec, needSecret: boolean): Fail | null {
  const shape = validateCredentials(credentials);
  if (shape) return { code: 'INVALID_FIELD', message: shape };

  const creds = (credentials ?? {}) as { clientId?: unknown; clientSecret?: unknown };
  if (!isStr(creds.clientId)) return { code: 'MISSING_CREDENTIALS', message: 'credentials.clientId is required' };
  if (needSecret && spec.clientSecretRequired && !isStr(creds.clientSecret)) {
    return { code: 'MISSING_CREDENTIALS', message: `credentials.clientSecret is required for ${spec.label}` };
  }
  return null;
}

router.post('/authorize-url', async (req, res) => {
  const start = Date.now();
  const input = (req.body ?? {}) as OAuthAuthorizeUrlInput;

  const resolved = resolveProvider(input.provider);
  if (isFail(resolved)) return sendError(res, 400, resolved.code, resolved.message);

  const creds = credentialsIssue(input.credentials, resolved.spec, false);
  if (creds) return sendError(res, 400, creds.code, creds.message);
  const redirectIssue = redirectUriIssue(input.redirectUri);
  if (redirectIssue) {
    return sendError(res, 400, redirectIssue === 'redirectUri is required' ? 'MISSING_FIELDS' : 'INVALID_FIELD', redirectIssue);
  }

  try {
    const result = buildAuthorizeUrl({ ...input, provider: resolved.name });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: resolved.name });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: resolved.name });
  }
});

router.post('/exchange-code', async (req, res) => {
  const start = Date.now();
  const input = (req.body ?? {}) as OAuthExchangeCodeInput;

  const resolved = resolveProvider(input.provider);
  if (isFail(resolved)) return sendError(res, 400, resolved.code, resolved.message);
  const { spec, name } = resolved;

  const creds = credentialsIssue(input.credentials, spec, true);
  if (creds) return sendError(res, 400, creds.code, creds.message);
  if (!isStr(input.code)) return sendError(res, 400, 'MISSING_FIELDS', 'code is required');
  if (spec.redirectUriOnExchange) {
    const redirectIssue = redirectUriIssue(input.redirectUri);
    if (redirectIssue) {
      return sendError(
        res,
        400,
        redirectIssue === 'redirectUri is required' ? 'MISSING_FIELDS' : 'INVALID_FIELD',
        redirectIssue === 'redirectUri is required'
          ? 'redirectUri is required (it must match the one used for authorize-url)'
          : redirectIssue,
      );
    }
  }
  if (spec.pkce === 'required' && !isStr(input.codeVerifier)) {
    return sendError(res, 400, 'MISSING_FIELDS', `codeVerifier is required for ${spec.label} (PKCE is mandatory) — send back the verifier returned by authorize-url`);
  }

  try {
    const result = await exchangeCode({ ...input, provider: name });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: name });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: name });
  }
});

router.post('/refresh', async (req, res) => {
  const start = Date.now();
  const input = (req.body ?? {}) as OAuthRefreshInput;

  const resolved = resolveProvider(input.provider);
  if (isFail(resolved)) return sendError(res, 400, resolved.code, resolved.message);
  const { spec, name } = resolved;

  const creds = credentialsIssue(input.credentials, spec, true);
  if (creds) return sendError(res, 400, creds.code, creds.message);
  if (spec.refresh === 'none') {
    return sendError(res, 400, 'UNSUPPORTED_ACTION', `${spec.label} does not support token refresh`);
  }
  if (spec.refresh === 'fb-exchange' && !isStr(input.accessToken)) {
    return sendError(res, 400, 'MISSING_FIELDS', `${spec.label} has no refresh token — pass accessToken (the current long-lived token) to re-exchange it`);
  }
  if (spec.refresh === 'refresh_token' && !isStr(input.refreshToken)) {
    return sendError(res, 400, 'MISSING_FIELDS', 'refreshToken is required');
  }

  try {
    const result = await refreshAccessToken({ ...input, provider: name });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: name, refreshed: result.refreshed });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: name });
  }
});

router.post('/profile', async (req, res) => {
  const start = Date.now();
  const input = (req.body ?? {}) as OAuthProfileInput;

  const resolved = resolveProvider(input.provider);
  if (isFail(resolved)) return sendError(res, 400, resolved.code, resolved.message);

  // `credentials` is optional here (meta apiVersion only) but still reaches a provider URL.
  const shape = validateCredentials(input.credentials);
  if (shape) return sendError(res, 400, 'INVALID_FIELD', shape);
  if (!isStr(input.accessToken)) return sendError(res, 400, 'MISSING_FIELDS', 'accessToken is required');

  try {
    const result = await fetchProfile(resolved.name, input.accessToken, input.credentials);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: resolved.name });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: resolved.name });
  }
});

// ---------------------------------------------------------------------------
// published schema (GET /api/tools)
// ---------------------------------------------------------------------------

const providerSchema = {
  type: 'string',
  enum: OAUTH_PROVIDERS,
  description: 'OAuth provider. Every endpoint, scope separator and quirk is table-driven — see providerNotes.',
};

const credentialsSchema = {
  type: 'object',
  required: ['clientId'],
  properties: {
    clientId: { type: 'string', description: 'OAuth app client id (TikTok: the client_key value)' },
    clientSecret: { type: 'string', description: 'Required for google, github, meta, linkedin, tiktok. Optional for microsoft/x public PKCE clients.' },
    tenantId: { type: 'string', description: 'microsoft only — Azure tenant id, "common" (default), "organizations" or "consumers". Letters, digits, dot, dash, underscore only.' },
    apiVersion: { type: 'string', description: 'meta only — Graph API version, shaped like "v23.0". Default v23.0' },
  },
};

/** Published verbatim from the provider table so the docs can never drift from the code. */
const providerNotes = Object.fromEntries(
  OAUTH_PROVIDERS.map((p) => [
    p,
    {
      label: PROVIDERS[p].label,
      pkce: PROVIDERS[p].pkce,
      refresh: PROVIDERS[p].refresh,
      rotatesRefreshToken: PROVIDERS[p].rotatesRefreshToken,
      defaultScopes: PROVIDERS[p].defaultScopes,
      notes: PROVIDERS[p].notes,
    },
  ]),
);

export const oauthTool: ToolDefinition = {
  name: 'oauth',
  description:
    'OAuth 2.0 for every provider the suite talks to (google, microsoft, github, meta, linkedin, tiktok, x): authorize URL with PKCE S256, code exchange, refresh with a 2-minute expiry window and rotated-token reporting, and a normalised profile. Credentials are per-request; nothing is stored.',
  actions: [
    {
      action: 'authorize-url',
      description:
        'Build the provider consent URL. Generates state and a PKCE verifier/challenge and RETURNS the verifier — persist it against the state, exchange-code needs it back.',
      inputSchema: {
        type: 'object',
        required: ['provider', 'credentials', 'redirectUri'],
        properties: {
          provider: providerSchema,
          credentials: credentialsSchema,
          redirectUri: { type: 'string', description: 'Absolute URI (custom app schemes allowed). Must match the value registered with the provider and the one sent to exchange-code' },
          scopes: { type: 'array', items: { type: 'string' }, description: 'Replaces the provider default scopes entirely' },
          state: { type: 'string', description: 'Opaque state. A 32-char hex value is generated when omitted.' },
          stateData: { type: 'object', description: 'JSON base64url-encoded into state when state is omitted (X strips quotes/commas from raw JSON state). Encoded, NOT signed or encrypted — no secrets in it.' },
          offlineAccess: { type: 'boolean', default: true, description: 'Ask for a refresh token: google access_type=offline+prompt=consent, microsoft offline_access, x offline.access' },
          usePkce: { type: 'boolean', default: true, description: 'Ignored where PKCE is required (x, tiktok web) or unsupported (github, linkedin)' },
          loginHint: { type: 'string' },
          prompt: { type: 'string', description: 'Overrides the provider default (google: consent, microsoft: select_account)' },
          extraParams: { type: 'object', description: 'Extra query params merged last' },
        },
        providerNotes,
      },
    },
    {
      action: 'exchange-code',
      description:
        'Exchange an authorization code for tokens -> { accessToken, refreshToken, expiresAt, scope, tokenType, idToken, refreshTokenExpiresAt }. Meta additionally upgrades the short-lived token to the ~60-day long-lived one.',
      inputSchema: {
        type: 'object',
        required: ['provider', 'credentials', 'code', 'redirectUri'],
        properties: {
          provider: providerSchema,
          credentials: credentialsSchema,
          code: { type: 'string', description: 'The ?code= value from the callback (single use)' },
          redirectUri: { type: 'string', description: 'The exact redirectUri used for authorize-url' },
          codeVerifier: { type: 'string', description: 'The verifier returned by authorize-url. Mandatory for x and for tiktok web apps.' },
          scopes: { type: 'array', items: { type: 'string' }, description: 'Only echoed on the token request for microsoft' },
        },
      },
    },
    {
      action: 'refresh',
      description:
        'Refresh an access token. Skips the call when the current token has more than 2 minutes left (pass accessToken + expiresAt). Returns refreshTokenRotated + the refresh token to persist — microsoft, x, tiktok, linkedin and GitHub Apps invalidate the old one.',
      inputSchema: {
        type: 'object',
        required: ['provider', 'credentials'],
        properties: {
          provider: providerSchema,
          credentials: credentialsSchema,
          refreshToken: { type: 'string', description: 'Required for every provider except meta' },
          accessToken: { type: 'string', description: 'Current access token. Required for meta (fb_exchange_token); elsewhere it enables the 2-minute safety window.' },
          expiresAt: { type: ['string', 'number'], description: 'ISO 8601 or epoch ms expiry of the current access token — enables the safety window' },
          force: { type: 'boolean', default: false, description: 'Refresh even when the current token is still valid' },
          scopes: { type: 'array', items: { type: 'string' }, description: 'Only echoed on the refresh request for microsoft' },
        },
      },
    },
    {
      action: 'profile',
      description: 'Fetch the account behind an access token, normalised to { id, email, name, avatar, username, raw }.',
      inputSchema: {
        type: 'object',
        required: ['provider', 'accessToken'],
        properties: {
          provider: providerSchema,
          accessToken: { type: 'string' },
          credentials: { ...credentialsSchema, required: [], description: 'Only needed for meta (apiVersion) — no secret is used by this action' },
        },
      },
    },
  ],
  router,
};
