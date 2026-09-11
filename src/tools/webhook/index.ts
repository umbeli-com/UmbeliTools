import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { dispatchWebhook } from './dispatcher';
import {
  verifyWebhookSignature,
  SIGNATURE_SCHEMES,
  DEFAULT_TOLERANCE_SECONDS,
  MAX_TOLERANCE_SECONDS,
} from './signature';
import type { WebhookDispatchInput, WebhookVerifySignatureInput } from './types';

const router = Router();

router.post('/dispatch', async (req, res) => {
  const start = Date.now();
  const input = req.body as WebhookDispatchInput;

  if (!input.url) {
    return sendError(res, 400, 'MISSING_FIELDS', 'url is required');
  }
  if (input.body === undefined) {
    return sendError(res, 400, 'MISSING_FIELDS', 'body is required');
  }

  try {
    const result = await dispatchWebhook(input.url, input.body, {
      method: input.method,
      headers: input.headers,
      timeoutMs: input.timeoutMs,
    });

    if (!result.success) {
      return sendError(res, 502, 'WEBHOOK_FAILED', `Webhook returned ${result.statusCode}`, result.responseBody, {
        durationMs: Date.now() - start,
      });
    }

    sendSuccess(res, result, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

/**
 * Verify an INBOUND webhook signature.
 *
 * A signature that does not match is NOT an HTTP error: this returns 200 with
 * `{ valid: false, reason }`. 4xx here means the request to THIS endpoint was
 * malformed (no secret, no raw body, unknown scheme).
 */
router.post('/verify-signature', async (req, res) => {
  const start = Date.now();
  const input = req.body as WebhookVerifySignatureInput;

  const secret = input.credentials?.secret ?? input.secret;
  if (!secret || typeof secret !== 'string') {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.secret is required');
  }
  if (!input.scheme) {
    return sendError(res, 400, 'MISSING_FIELDS', `scheme is required (one of: ${SIGNATURE_SCHEMES.join(', ')})`);
  }
  if (!SIGNATURE_SCHEMES.includes(input.scheme)) {
    return sendError(
      res,
      400,
      'INVALID_FIELD',
      `Unsupported scheme "${input.scheme}". Supported: ${SIGNATURE_SCHEMES.join(', ')}`,
    );
  }
  if (typeof input.rawBody !== 'string') {
    return sendError(
      res,
      400,
      'MISSING_FIELDS',
      'rawBody is required and must be a string holding the EXACT bytes received on the wire. ' +
        'If your app ran express.json() before capturing it, those bytes are gone and no signature will ever match — ' +
        'capture the buffer with express.raw() or express.json({ verify }) first.',
    );
  }
  if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) {
    return sendError(res, 400, 'MISSING_FIELDS', 'headers is required (pass the inbound request headers object)');
  }
  if (input.rawBodyEncoding !== undefined && input.rawBodyEncoding !== 'utf8' && input.rawBodyEncoding !== 'base64') {
    return sendError(res, 400, 'INVALID_FIELD', "rawBodyEncoding must be 'utf8' or 'base64'");
  }
  if (input.secretEncoding !== undefined && input.secretEncoding !== 'utf8' && input.secretEncoding !== 'base64') {
    return sendError(res, 400, 'INVALID_FIELD', "secretEncoding must be 'utf8' or 'base64'");
  }
  if (input.toleranceSeconds !== undefined) {
    const t = input.toleranceSeconds;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > MAX_TOLERANCE_SECONDS) {
      return sendError(
        res,
        400,
        'INVALID_FIELD',
        `toleranceSeconds must be a number > 0 and <= ${MAX_TOLERANCE_SECONDS} (default ${DEFAULT_TOLERANCE_SECONDS}). ` +
          'There is no way to disable the replay window.',
      );
    }
  }
  if (input.signatureHeader !== undefined && typeof input.signatureHeader !== 'string') {
    return sendError(res, 400, 'INVALID_FIELD', 'signatureHeader must be a string (an HTTP header name)');
  }
  if (input.url !== undefined && typeof input.url !== 'string') {
    return sendError(res, 400, 'INVALID_FIELD', 'url must be a string');
  }
  if (
    input.params !== undefined &&
    (input.params === null || typeof input.params !== 'object' || Array.isArray(input.params))
  ) {
    return sendError(res, 400, 'INVALID_FIELD', 'params must be an object of decoded form parameters');
  }
  if (input.scheme === 'twilio' && !input.url) {
    return sendError(
      res,
      400,
      'MISSING_FIELDS',
      'url is required for the twilio scheme: Twilio signs the exact public URL it requested, query string included',
    );
  }

  try {
    const rawBody = Buffer.from(input.rawBody, input.rawBodyEncoding === 'base64' ? 'base64' : 'utf8');
    const result = verifyWebhookSignature({
      scheme: input.scheme,
      rawBody,
      headers: input.headers,
      secret,
      options: {
        toleranceSeconds: input.toleranceSeconds,
        secretEncoding: input.secretEncoding,
        url: input.url,
        params: input.params,
        signatureHeader: input.signatureHeader,
      },
    });

    sendSuccess(res, result, {
      durationMs: Date.now() - start,
      provider: 'local',
      scheme: input.scheme,
    });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

const RAW_BODY_WARNING =
  'MUST be the EXACT bytes of the inbound request body. express.json() DESTROYS them: re-serialising the parsed ' +
  'object changes key order, spacing and unicode escaping, so the HMAC never matches and you get valid:false ' +
  'forever with a perfectly good secret. Capture the buffer BEFORE any body parser — ' +
  'app.post(path, express.raw({ type: "application/json" }), handler) and use req.body, or ' +
  'app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })) and use req.rawBody — ' +
  'then send buf.toString("utf8") here (or buf.toString("base64") with rawBodyEncoding:"base64").';

export const webhookTool: ToolDefinition = {
  name: 'webhook',
  description: 'Dispatch outbound HTTP webhooks and verify inbound webhook signatures (HMAC, constant-time, replay-windowed)',
  actions: [
    {
      action: 'dispatch',
      description: 'Send an HTTP request to a webhook URL',
      inputSchema: {
        type: 'object',
        required: ['url', 'body'],
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'], default: 'POST' },
          headers: { type: 'object', description: 'Additional HTTP headers' },
          body: { description: 'The JSON payload to send' },
          timeoutMs: { type: 'number', default: 10000 },
        },
      },
    },
    {
      action: 'verify-signature',
      description:
        'Verify an inbound webhook signature (standard-webhooks/svix, github, tiktok, twilio, stripe-style). ' +
        'Every comparison is crypto.timingSafeEqual (length-checked first) and every timestamped scheme enforces a ' +
        'replay window that defaults to 300s and cannot be turned off. Returns HTTP 200 with { valid, scheme, reason } ' +
        'even when the signature is bad — 4xx means the call to this endpoint was malformed. ' +
        'RAW BODY REQUIRED: ' + RAW_BODY_WARNING,
      inputSchema: {
        type: 'object',
        required: ['scheme', 'credentials', 'rawBody', 'headers'],
        properties: {
          scheme: {
            type: 'string',
            enum: SIGNATURE_SCHEMES,
            description:
              'standard-webhooks: webhook-id/webhook-timestamp/webhook-signature, HMAC-SHA256 base64 over "id.ts.body" ' +
              '(Supabase auth hooks, svix). | github: x-hub-signature-256 = sha256=<hex> over the body; no timestamp, ' +
              'dedupe on eventId. | tiktok: tiktok-signature "t=..,s=<hex>" over "t.body". | twilio: x-twilio-signature, ' +
              'HMAC-SHA1 base64 over url + sorted form params (or url with ?bodySHA256=<hex> for JSON posts); no timestamp. ' +
              '| stripe-style: stripe-signature "t=..,v1=<hex>" over "t.body", key = the whsec_ secret as-is.',
          },
          credentials: {
            type: 'object',
            required: ['secret'],
            properties: {
              secret: {
                type: 'string',
                description:
                  'The signing secret. standard-webhooks: "whsec_<base64>" (the base64 part is decoded to the key). ' +
                  'github: the webhook secret. tiktok: the app client secret. twilio: the account auth token. ' +
                  'stripe-style: the endpoint secret used verbatim, whsec_ prefix included.',
              },
            },
          },
          secret: { type: 'string', description: 'Alias for credentials.secret (credentials.secret wins).' },
          rawBody: { type: 'string', description: RAW_BODY_WARNING },
          rawBodyEncoding: {
            type: 'string',
            enum: ['utf8', 'base64'],
            default: 'utf8',
            description: 'Use base64 when the payload is not clean UTF-8, so the bytes survive the JSON hop.',
          },
          headers: {
            type: 'object',
            description:
              'The inbound request headers. Express req.headers can be passed straight through: names are ' +
              'lower-cased and array values collapse to the first entry.',
          },
          toleranceSeconds: {
            type: 'number',
            default: DEFAULT_TOLERANCE_SECONDS,
            description:
              `Replay window for standard-webhooks / tiktok / stripe-style. Defaults to ${DEFAULT_TOLERANCE_SECONDS}s, ` +
              `must be > 0 and <= ${MAX_TOLERANCE_SECONDS}; it can never be disabled. Ignored by github and twilio, ` +
              'which sign no timestamp (result.replayProtected is false there — dedupe on result.eventId).',
          },
          secretEncoding: {
            type: 'string',
            enum: ['utf8', 'base64'],
            default: 'base64',
            description: 'standard-webhooks only: how the secret becomes the HMAC key. Ignored by other schemes.',
          },
          url: {
            type: 'string',
            description:
              'twilio only, REQUIRED: the exact public URL Twilio requested, query string included. Behind a proxy, ' +
              'rebuild it from x-forwarded-proto / x-forwarded-host — a rewritten scheme or host breaks the signature.',
          },
          params: {
            type: 'object',
            description:
              'twilio only, optional: the decoded application/x-www-form-urlencoded params. Parsed from rawBody when omitted.',
          },
          signatureHeader: {
            type: 'string',
            default: 'stripe-signature',
            description: 'stripe-style only: override the header name for a Stripe-compatible sender.',
          },
        },
      },
    },
  ],
  router,
};
