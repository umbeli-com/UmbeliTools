import { UmbeliToolsCore } from '../client.js';

export interface WebhookDispatchInput {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}

export interface WebhookDispatchResult {
  success: boolean;
  statusCode: number;
  responseBody?: unknown;
  [key: string]: unknown;
}

/* ── inbound signature verification ───────────────────────────────────────── */

export type WebhookSignatureScheme =
  | 'standard-webhooks'
  | 'github'
  | 'tiktok'
  | 'twilio'
  | 'stripe-style';

export interface WebhookVerifySignatureInput {
  /**
   * - `standard-webhooks` — svix / Supabase auth hooks: `webhook-id`,
   *   `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 (base64) over
   *   `id.timestamp.body`, key = base64-decoded `whsec_` secret.
   * - `github` — `x-hub-signature-256: sha256=<hex>` over the body. No timestamp.
   * - `tiktok` — `tiktok-signature: t=<ts>,s=<hex>` over `ts.body`.
   * - `twilio` — `x-twilio-signature`: HMAC-SHA1 (base64) over the request URL
   *   plus the sorted form params (or the URL alone, with `?bodySHA256=<hex>`
   *   binding the JSON body). No timestamp. Requires `url`.
   * - `stripe-style` — `stripe-signature: t=<ts>,v1=<hex>` over `ts.body`,
   *   key = the `whsec_…` endpoint secret verbatim.
   */
  scheme: WebhookSignatureScheme;
  /** The signing secret (auth token for twilio, client secret for tiktok). */
  credentials: { secret: string };
  /**
   * ⚠️ THE EXACT BYTES OF THE INBOUND REQUEST BODY.
   *
   * `express.json()` destroys them — re-serialising the parsed object changes
   * key order, spacing and unicode escaping, so the HMAC never matches and this
   * returns `valid: false` forever with a perfectly good secret. Capture the
   * buffer BEFORE any body parser:
   *
   * ```ts
   * app.post('/hook', express.raw({ type: 'application/json' }), (req, res) => {
   *   const raw = req.body as Buffer;            // exact bytes
   *   await tools.webhook.verifySignature({ scheme, credentials, rawBody: raw.toString('utf8'), headers: req.headers });
   * });
   * // or globally: express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } })
   * ```
   */
  rawBody: string;
  /** Use `'base64'` (with `buf.toString('base64')`) when the payload is not clean UTF-8. */
  rawBodyEncoding?: 'utf8' | 'base64';
  /** Inbound headers — Express `req.headers` can be passed straight through. */
  headers: Record<string, string | string[] | undefined>;
  /**
   * Replay window for the timestamped schemes (standard-webhooks, tiktok,
   * stripe-style). Defaults to 300s server-side; must be > 0 and <= 86400.
   * It cannot be disabled. Ignored by github and twilio, which sign no timestamp.
   */
  toleranceSeconds?: number;
  /** `standard-webhooks` only: how the secret becomes the key. Default `'base64'`. */
  secretEncoding?: 'utf8' | 'base64';
  /** `twilio` only, REQUIRED: the exact public URL Twilio hit, query string included. */
  url?: string;
  /** `twilio` only: decoded form params; parsed from `rawBody` when omitted. */
  params?: Record<string, string>;
  /** `stripe-style` only: override the header name (default `stripe-signature`). */
  signatureHeader?: string;
}

export type WebhookVerifyFailureReason =
  | 'missing_headers'
  | 'invalid_signature_header'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch'
  | 'invalid_secret'
  | 'body_hash_mismatch'
  | 'invalid_url'
  /** `github`: only the legacy SHA-1 `x-hub-signature` was sent; SHA-1 is not accepted. */
  | 'sha1_signature_not_supported'
  | 'unsupported_scheme'
  | (string & {});

export interface WebhookVerifySignatureResult {
  /** true only when the signature matched AND the replay window (if any) held. */
  valid: boolean;
  scheme: WebhookSignatureScheme;
  /** Why it failed. Absent when `valid` is true. */
  reason?: WebhookVerifyFailureReason;
  /** Sender-side unique id (`webhook-id`, `x-github-delivery`) for your own dedup. */
  eventId?: string;
  /** |now − signed timestamp| in seconds, for the schemes that sign one. */
  timestampSkewSeconds?: number;
  /** The window applied; `null` for schemes with no timestamp. */
  toleranceSeconds?: number | null;
  /** `false` ⇒ no timestamp in the scheme: de-duplicate on `eventId` yourself. */
  replayProtected: boolean;
  /** twilio JSON deliveries: whether the `bodySHA256` body binding was checked. */
  bodyHashChecked?: boolean;
}

export class WebhookTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  dispatch(input: WebhookDispatchInput) {
    return this.core.request<WebhookDispatchResult>('webhook', 'dispatch', input);
  }

  /**
   * Verify an inbound webhook signature in constant time, with a replay window.
   *
   * A bad signature is NOT thrown: it resolves with `{ valid: false, reason }`.
   * A rejected promise means the call itself was malformed (missing secret,
   * missing raw body, unknown scheme) or the service was unreachable.
   *
   * ⚠️ `rawBody` must be the exact bytes received — see {@link WebhookVerifySignatureInput.rawBody}.
   */
  verifySignature(input: WebhookVerifySignatureInput) {
    return this.core.request<WebhookVerifySignatureResult>('webhook', 'verify-signature', input);
  }
}
