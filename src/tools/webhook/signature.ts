import crypto from 'crypto';
import type {
  WebhookSignatureScheme,
  WebhookVerifySignatureResult,
  WebhookVerifyOptions,
} from './types';

/**
 * Inbound webhook signature verification.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE RAW BODY IS THE WHOLE GAME
 * ─────────────────────────────────────────────────────────────────────────────
 * Every scheme below signs the EXACT BYTES the sender put on the wire. If the
 * receiving app ran `express.json()` (or any body parser) before capturing the
 * body, those bytes are GONE: `JSON.stringify(req.body)` re-serialises with
 * different key order, different spacing, different unicode escaping — and the
 * HMAC will never match. The failure is silent: `valid: false`, forever, with a
 * perfectly good secret. Capture the buffer first:
 *
 *     app.post('/hook', express.raw({ type: 'application/json' }), handler)  // handler sees req.body as a Buffer
 *     // or globally:
 *     app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
 *
 * then send that buffer here as `rawBody` (utf8, or base64 with
 * `rawBodyEncoding: 'base64'` when the payload is not clean UTF-8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONSTANT TIME
 * ─────────────────────────────────────────────────────────────────────────────
 * Every comparison in this file goes through `timingSafeEqualStr` /
 * `timingSafeEqualBuf`, which compare lengths FIRST (a length mismatch is not
 * secret, and `crypto.timingSafeEqual` THROWS on unequal buffer lengths) and
 * then do a constant-time byte compare. Candidate lists (key rotation: several
 * `v1,` signatures in one header) are folded without short-circuiting so the
 * number of candidates tried does not leak which one matched.
 */

/** Default replay window, in seconds, for every scheme that signs a timestamp. */
export const DEFAULT_TOLERANCE_SECONDS = 300;
/** Upper bound accepted for a caller-supplied tolerance (24h). */
export const MAX_TOLERANCE_SECONDS = 86_400;

export const SIGNATURE_SCHEMES: WebhookSignatureScheme[] = [
  'standard-webhooks',
  'github',
  'tiktok',
  'twilio',
  'stripe-style',
];

/* ── constant-time primitives ─────────────────────────────────────────────── */

export function timingSafeEqualBuf(a: Buffer, b: Buffer): boolean {
  // Length is compared first: it is not a secret, and timingSafeEqual throws
  // (does not return false) when the two buffers differ in length.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqualBuf(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * True when `expected` matches ANY candidate. Every candidate is evaluated
 * (no `.some()` short-circuit) so timing does not reveal which one matched.
 */
function anyTimingSafeMatch(candidates: string[], expected: string): boolean {
  let matched = false;
  for (const candidate of candidates) {
    if (timingSafeEqualStr(candidate, expected)) matched = true;
  }
  return matched;
}

/* ── small helpers ────────────────────────────────────────────────────────── */

export type RawHeaders = Record<string, string | string[] | undefined>;

/** Lower-case the header names and collapse array values to the first entry. */
export function normalizeHeaders(headers: RawHeaders): Record<string, string> {
  // Null prototype: a header (or signature part) literally named `__proto__`
  // must land as an ordinary key, never touch an object prototype.
  const out: Record<string, string> = Object.create(null);
  if (!headers || typeof headers !== 'object') return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v === undefined || v === null) continue;
    out[String(key).toLowerCase()] = String(v);
  }
  return out;
}

/** Parse `t=123,v1=abc,v1=def` style headers into a key → values map. */
function parseCommaKeyValues(header: string): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null);
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) continue;
    (out[key] ||= []).push(value);
  }
  return out;
}

function hmac(algo: 'sha1' | 'sha256', key: Buffer | string, data: Buffer, encoding: 'hex' | 'base64') {
  return crypto.createHmac(algo, key).update(data).digest(encoding);
}

/** `${prefix}${rawBody}` as bytes — never as a string, so the body bytes survive. */
function prefixedBody(prefix: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(prefix, 'utf8'), rawBody]);
}

interface TimestampCheck {
  ok: boolean;
  reason?: string;
  skewSeconds?: number;
}

/**
 * Replay window. The tolerance is ALWAYS a finite number here (the caller-facing
 * route defaults it to DEFAULT_TOLERANCE_SECONDS): there is no "open window"
 * code path, a missing or unparsable timestamp is a hard failure.
 */
function checkTimestamp(raw: string | undefined, toleranceSeconds: number): TimestampCheck {
  if (!raw) return { ok: false, reason: 'missing_timestamp' };
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid_timestamp' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const skewSeconds = Math.abs(nowSeconds - ts);
  if (skewSeconds > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_tolerance', skewSeconds };
  }
  return { ok: true, skewSeconds };
}

function fail(
  scheme: WebhookSignatureScheme,
  reason: string,
  extra: Partial<WebhookVerifySignatureResult> = {},
): WebhookVerifySignatureResult {
  return { valid: false, scheme, reason, replayProtected: false, ...extra };
}

/* ── scheme: standard-webhooks (Svix / Supabase auth hooks) ───────────────── */

/**
 * Standard Webhooks (svix). Headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature` (also accepted under their `svix-*` aliases).
 * Signed content: `${id}.${timestamp}.${rawBody}`, HMAC-SHA256, base64.
 * The secret is `whsec_<base64>` and the KEY IS THE BASE64-DECODED remainder
 * (pass `secretEncoding: 'utf8'` for senders that use the literal string).
 */
function verifyStandardWebhooks(
  rawBody: Buffer,
  h: Record<string, string>,
  secret: string,
  opts: Required<Pick<WebhookVerifyOptions, 'toleranceSeconds'>> & { secretEncoding: 'utf8' | 'base64' },
): WebhookVerifySignatureResult {
  const scheme: WebhookSignatureScheme = 'standard-webhooks';
  const id = h['webhook-id'] || h['svix-id'];
  const timestamp = h['webhook-timestamp'] || h['svix-timestamp'];
  const sigHeader = h['webhook-signature'] || h['svix-signature'];

  if (!id || !timestamp || !sigHeader) {
    return fail(scheme, 'missing_headers', { toleranceSeconds: opts.toleranceSeconds });
  }

  const ts = checkTimestamp(timestamp, opts.toleranceSeconds);
  if (!ts.ok) {
    return fail(scheme, ts.reason!, {
      eventId: id,
      timestampSkewSeconds: ts.skewSeconds,
      toleranceSeconds: opts.toleranceSeconds,
    });
  }

  const trimmed = String(secret).replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = opts.secretEncoding === 'base64' ? Buffer.from(trimmed, 'base64') : Buffer.from(trimmed, 'utf8');
  if (key.length === 0) {
    return fail(scheme, 'invalid_secret', { eventId: id, toleranceSeconds: opts.toleranceSeconds });
  }

  const expected = hmac('sha256', key, prefixedBody(`${id}.${timestamp}.`, rawBody), 'base64');

  // `v1,<sig> v1,<sig>` — space separated, several versions during rotation.
  const candidates = sigHeader
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const comma = part.indexOf(',');
      if (comma === -1) return part;
      const version = part.slice(0, comma);
      return version === 'v1' ? part.slice(comma + 1) : '';
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    return fail(scheme, 'invalid_signature_header', { eventId: id, toleranceSeconds: opts.toleranceSeconds });
  }

  const valid = anyTimingSafeMatch(candidates, expected);
  return {
    valid,
    scheme,
    reason: valid ? undefined : 'signature_mismatch',
    eventId: id,
    timestampSkewSeconds: ts.skewSeconds,
    toleranceSeconds: opts.toleranceSeconds,
    replayProtected: true,
  };
}

/* ── scheme: github ───────────────────────────────────────────────────────── */

/**
 * GitHub: header `x-hub-signature-256` = `sha256=<hex>`, HMAC-SHA256 of the raw
 * body with the webhook secret as a UTF-8 key.
 *
 * GitHub sends NO timestamp, so there is nothing to bound: `replayProtected` is
 * false and the caller must de-duplicate on `eventId` (`x-github-delivery`).
 */
function verifyGithub(rawBody: Buffer, h: Record<string, string>, secret: string): WebhookVerifySignatureResult {
  const scheme: WebhookSignatureScheme = 'github';
  const eventId = h['x-github-delivery'] || undefined;
  const sigHeader = h['x-hub-signature-256'];

  if (!sigHeader) {
    // The legacy SHA-1 header is deliberately not accepted.
    const reason = h['x-hub-signature'] ? 'sha1_signature_not_supported' : 'missing_headers';
    return fail(scheme, reason, { eventId, toleranceSeconds: null });
  }

  const expected = 'sha256=' + hmac('sha256', Buffer.from(secret, 'utf8'), rawBody, 'hex');
  // Hex case is not secret; normalise so an upper-case sender still verifies.
  const valid = timingSafeEqualStr(sigHeader.trim().toLowerCase(), expected);

  return {
    valid,
    scheme,
    reason: valid ? undefined : 'signature_mismatch',
    eventId,
    toleranceSeconds: null,
    replayProtected: false,
  };
}

/* ── scheme: tiktok ───────────────────────────────────────────────────────── */

/**
 * TikTok: header `tiktok-signature` = `t=<unix seconds>,s=<hex>`.
 * Signed content: `${t}.${rawBody}`, HMAC-SHA256, hex, key = client secret.
 */
function verifyTiktok(
  rawBody: Buffer,
  h: Record<string, string>,
  secret: string,
  toleranceSeconds: number,
): WebhookVerifySignatureResult {
  const scheme: WebhookSignatureScheme = 'tiktok';
  const sigHeader = h['tiktok-signature'];
  if (!sigHeader) return fail(scheme, 'missing_headers', { toleranceSeconds });

  const parts = parseCommaKeyValues(sigHeader);
  const timestamp = parts.t?.[0];
  const signatures = parts.s ?? [];
  if (!timestamp || signatures.length === 0) {
    return fail(scheme, 'invalid_signature_header', { toleranceSeconds });
  }

  const ts = checkTimestamp(timestamp, toleranceSeconds);
  if (!ts.ok) {
    return fail(scheme, ts.reason!, { timestampSkewSeconds: ts.skewSeconds, toleranceSeconds });
  }

  const expected = hmac('sha256', Buffer.from(secret, 'utf8'), prefixedBody(`${timestamp}.`, rawBody), 'hex');
  const valid = anyTimingSafeMatch(signatures.map((s) => s.toLowerCase()), expected);

  return {
    valid,
    scheme,
    reason: valid ? undefined : 'signature_mismatch',
    timestampSkewSeconds: ts.skewSeconds,
    toleranceSeconds,
    replayProtected: true,
  };
}

/* ── scheme: twilio ───────────────────────────────────────────────────────── */

function twilioFormParams(rawBody: Buffer, provided?: Record<string, string>): Record<string, string> {
  if (provided && Object.keys(provided).length > 0) return provided;
  const params: Record<string, string> = Object.create(null);
  const search = new URLSearchParams(rawBody.toString('utf8'));
  for (const [key, value] of search.entries()) params[key] = value;
  return params;
}

/**
 * Twilio: header `x-twilio-signature`, HMAC-SHA1 (base64) with the account auth
 * token as key over:
 *   - form-encoded posts: the full request URL + every POST param, sorted by
 *     name, concatenated as name+value;
 *   - JSON posts: the full request URL ONLY, which Twilio has appended
 *     `?bodySHA256=<sha256 hex of the raw body>` to — so the raw body is bound
 *     to the signature through that hash, which we check first.
 *
 * `url` MUST be the exact public URL Twilio hit, query string included. Behind
 * a proxy that rewrites scheme/host, rebuild it from `x-forwarded-proto` /
 * `x-forwarded-host` — a mismatched URL is the #2 cause of `valid: false` here,
 * right after a re-serialised body.
 *
 * Twilio sends NO timestamp: `replayProtected` is false.
 */
function verifyTwilio(
  rawBody: Buffer,
  h: Record<string, string>,
  secret: string,
  url: string,
  params?: Record<string, string>,
): WebhookVerifySignatureResult {
  const scheme: WebhookSignatureScheme = 'twilio';
  const sigHeader = h['x-twilio-signature'];
  if (!sigHeader) return fail(scheme, 'missing_headers', { toleranceSeconds: null });

  let data = url;
  let bodyHashChecked = false;

  let bodySha256: string | null = null;
  try {
    bodySha256 = new URL(String(url)).searchParams.get('bodySHA256');
  } catch {
    return fail(scheme, 'invalid_url', { toleranceSeconds: null });
  }

  if (bodySha256) {
    // JSON delivery: the body is bound through the bodySHA256 query param.
    const actual = crypto.createHash('sha256').update(rawBody).digest('hex');
    if (!timingSafeEqualStr(bodySha256.toLowerCase(), actual)) {
      return fail(scheme, 'body_hash_mismatch', { toleranceSeconds: null });
    }
    bodyHashChecked = true;
  } else {
    const flat = twilioFormParams(rawBody, params);
    for (const key of Object.keys(flat).sort()) data += key + flat[key];
  }

  const expected = hmac('sha1', Buffer.from(secret, 'utf8'), Buffer.from(data, 'utf8'), 'base64');
  const valid = timingSafeEqualStr(sigHeader.trim(), expected);

  return {
    valid,
    scheme,
    reason: valid ? undefined : 'signature_mismatch',
    toleranceSeconds: null,
    replayProtected: false,
    bodyHashChecked,
  };
}

/* ── scheme: stripe-style ─────────────────────────────────────────────────── */

/**
 * Stripe (and every clone of its scheme): header `stripe-signature` =
 * `t=<unix seconds>,v1=<hex>[,v1=<hex>]`. Signed content `${t}.${rawBody}`,
 * HMAC-SHA256, hex, key = the endpoint secret AS-IS (`whsec_…` prefix included
 * — unlike Standard Webhooks, Stripe does NOT base64-decode it).
 */
function verifyStripeStyle(
  rawBody: Buffer,
  h: Record<string, string>,
  secret: string,
  toleranceSeconds: number,
  headerName: string,
): WebhookVerifySignatureResult {
  const scheme: WebhookSignatureScheme = 'stripe-style';
  const sigHeader = h[String(headerName).toLowerCase()];
  if (!sigHeader) return fail(scheme, 'missing_headers', { toleranceSeconds });

  const parts = parseCommaKeyValues(sigHeader);
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) {
    return fail(scheme, 'invalid_signature_header', { toleranceSeconds });
  }

  const ts = checkTimestamp(timestamp, toleranceSeconds);
  if (!ts.ok) {
    return fail(scheme, ts.reason!, { timestampSkewSeconds: ts.skewSeconds, toleranceSeconds });
  }

  const expected = hmac('sha256', Buffer.from(secret, 'utf8'), prefixedBody(`${timestamp}.`, rawBody), 'hex');
  const valid = anyTimingSafeMatch(signatures.map((s) => s.toLowerCase()), expected);

  return {
    valid,
    scheme,
    reason: valid ? undefined : 'signature_mismatch',
    timestampSkewSeconds: ts.skewSeconds,
    toleranceSeconds,
    replayProtected: true,
  };
}

/* ── entry point ──────────────────────────────────────────────────────────── */

export interface VerifyArgs {
  scheme: WebhookSignatureScheme;
  /** EXACT bytes received on the wire — see the file header. */
  rawBody: Buffer;
  headers: RawHeaders;
  secret: string;
  options?: WebhookVerifyOptions;
}

export function verifyWebhookSignature(args: VerifyArgs): WebhookVerifySignatureResult {
  const { scheme, rawBody, secret } = args;
  const h = normalizeHeaders(args.headers);
  const opts = args.options ?? {};
  const toleranceSeconds =
    typeof opts.toleranceSeconds === 'number' ? opts.toleranceSeconds : DEFAULT_TOLERANCE_SECONDS;

  switch (scheme) {
    case 'standard-webhooks':
      return verifyStandardWebhooks(rawBody, h, secret, {
        toleranceSeconds,
        secretEncoding: opts.secretEncoding ?? 'base64',
      });
    case 'github':
      return verifyGithub(rawBody, h, secret);
    case 'tiktok':
      return verifyTiktok(rawBody, h, secret, toleranceSeconds);
    case 'twilio':
      return verifyTwilio(rawBody, h, secret, opts.url ?? '', opts.params);
    case 'stripe-style':
      return verifyStripeStyle(rawBody, h, secret, toleranceSeconds, opts.signatureHeader ?? 'stripe-signature');
    default:
      return fail(scheme, 'unsupported_scheme');
  }
}
