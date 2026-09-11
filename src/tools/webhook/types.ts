export interface WebhookDispatchInput {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}

/* ── inbound signature verification ───────────────────────────────────────── */

export type WebhookSignatureScheme =
  /** Standard Webhooks / svix (Supabase auth hooks, Resend, …) */
  | 'standard-webhooks'
  /** GitHub `x-hub-signature-256` */
  | 'github'
  /** TikTok `tiktok-signature` (`t=…,s=…`) */
  | 'tiktok'
  /** Twilio `x-twilio-signature` (HMAC-SHA1 over URL + params) */
  | 'twilio'
  /** Stripe `stripe-signature` (`t=…,v1=…`) and anything that copies it */
  | 'stripe-style';

export interface WebhookVerifyOptions {
  /**
   * Replay window in seconds for the schemes that sign a timestamp
   * (standard-webhooks, tiktok, stripe-style). Defaults to 300 — never open.
   */
  toleranceSeconds?: number;
  /**
   * How to turn the secret into an HMAC key, for `standard-webhooks` only.
   * 'base64' (default, spec-correct: `whsec_<base64>` -> decoded bytes) or
   * 'utf8' for senders that HMAC with the literal secret string.
   */
  secretEncoding?: 'utf8' | 'base64';
  /** twilio only: the EXACT public URL Twilio requested, query string included. */
  url?: string;
  /** twilio only: the decoded form params; parsed from rawBody when omitted. */
  params?: Record<string, string>;
  /** stripe-style only: override the header name (default `stripe-signature`). */
  signatureHeader?: string;
}

export interface WebhookVerifySignatureInput extends WebhookVerifyOptions {
  scheme: WebhookSignatureScheme;
  /** Canonical location for the signing secret. */
  credentials?: { secret: string };
  /** Accepted alias for `credentials.secret`. */
  secret?: string;
  /**
   * THE EXACT BYTES OF THE REQUEST BODY, as received. A body that has been
   * through `express.json()` and re-serialised will NEVER verify.
   */
  rawBody: string;
  /** How `rawBody` is encoded. Use 'base64' for payloads that are not clean UTF-8. */
  rawBodyEncoding?: 'utf8' | 'base64';
  /** The inbound request headers (Express `req.headers` can be passed straight through). */
  headers: Record<string, string | string[] | undefined>;
}

export interface WebhookVerifySignatureResult {
  /** true only when the signature matched AND the replay window (if any) held. */
  valid: boolean;
  scheme: WebhookSignatureScheme;
  /**
   * Machine-readable failure cause when `valid` is false: `missing_headers` |
   * `invalid_signature_header` | `missing_timestamp` | `invalid_timestamp` |
   * `timestamp_out_of_tolerance` | `signature_mismatch` | `invalid_secret` |
   * `body_hash_mismatch` | `invalid_url` | `sha1_signature_not_supported` |
   * `unsupported_scheme`.
   */
  reason?: string;
  /** Sender-side unique id for caller-side dedup (`webhook-id`, `x-github-delivery`). */
  eventId?: string;
  /** |now - signed timestamp| in seconds, for the schemes that sign one. */
  timestampSkewSeconds?: number;
  /** The window actually applied; `null` when the scheme carries no timestamp. */
  toleranceSeconds?: number | null;
  /** false => the scheme has no timestamp: de-duplicate on `eventId` yourself. */
  replayProtected: boolean;
  /** twilio JSON deliveries: whether the `bodySHA256` binding was checked. */
  bodyHashChecked?: boolean;
}
