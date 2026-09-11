import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { emitEvent, EVENTS_PROVIDER, checkManagerUrl } from './manager.adapter';
import type { EventsEmitInput } from './types';

const router = Router();

/** `type` and `source` are pasted into server log lines, and persisted upstream. */
const MAX_LABEL_LENGTH = 200;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Non-empty, bounded, and free of the control characters that forge log lines. */
function labelProblem(field: string, value: string): string | null {
  if (value.length > MAX_LABEL_LENGTH) return `${field} must be at most ${MAX_LABEL_LENGTH} characters`;
  if (CONTROL_CHARS.test(value)) return `${field} must not contain control characters`;
  return null;
}

/** `undefined` passes (the adapter's default applies); anything non-finite is refused. */
function numberProblem(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${field} must be a finite number`;
  }
  return null;
}

function tenantProblem(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return `${field} must be a string or null`;
  if (value.length > MAX_LABEL_LENGTH) return `${field} must be at most ${MAX_LABEL_LENGTH} characters`;
  return null;
}

router.post('/emit', async (req, res) => {
  const start = Date.now();
  const input = (req.body ?? {}) as EventsEmitInput;

  if (
    typeof input.credentials?.managerUrl !== 'string' ||
    typeof input.credentials?.serviceKey !== 'string' ||
    !input.credentials.managerUrl ||
    !input.credentials.serviceKey
  ) {
    return sendError(
      res,
      400,
      'MISSING_CREDENTIALS',
      'credentials.managerUrl and credentials.serviceKey are required and must be strings',
    );
  }
  // A bad base URL is the caller's config error, not a bus outage: answer 400
  // instead of letting it come back as a silent delivered:false.
  const checkedUrl = checkManagerUrl(input.credentials.managerUrl);
  if ('error' in checkedUrl) {
    return sendError(res, 400, 'INVALID_FIELD', checkedUrl.error);
  }
  if (!input.type || typeof input.type !== 'string') {
    return sendError(res, 400, 'MISSING_FIELDS', 'type is required and must be a string');
  }
  if (!input.source || typeof input.source !== 'string') {
    return sendError(res, 400, 'MISSING_FIELDS', 'source is required and must be a string');
  }
  const fieldProblem =
    labelProblem('type', input.type) ??
    labelProblem('source', input.source) ??
    tenantProblem('tenantId', input.tenantId) ??
    tenantProblem('tenant_id', input.tenant_id) ??
    numberProblem('timeoutMs', input.timeoutMs) ??
    numberProblem('retries', input.retries);
  if (fieldProblem) {
    return sendError(res, 400, 'INVALID_FIELD', fieldProblem);
  }
  // UmbeliumManager rejects a null/undefined payload with a 400, so catch it here
  // instead of burning a round-trip and reporting it as an undeliverable event.
  if (input.payload === undefined || input.payload === null) {
    return sendError(res, 400, 'MISSING_FIELDS', 'payload is required and cannot be null');
  }

  // emitEvent never throws: a bus outage comes back as delivered:false, not a 502,
  // so a caller awaiting this in a signup flow cannot be broken by the bus being down.
  const result = await emitEvent(input.credentials, {
    type: input.type,
    payload: input.payload,
    source: input.source,
    tenantId: input.tenantId ?? input.tenant_id ?? null,
    timeoutMs: input.timeoutMs,
    retries: input.retries,
  });

  sendSuccess(res, result, { durationMs: Date.now() - start, provider: EVENTS_PROVIDER });
});

export const eventsTool: ToolDefinition = {
  name: 'events',
  description:
    'Fire-and-forget emit to the UmbeliumManager cross-service event bus (POST /api/events/emit). Never fails the caller: a bus outage returns ok:true with delivered:false.',
  actions: [
    {
      action: 'emit',
      description:
        'Emit a cross-service event to UmbeliumManager, which persists it in umbelium_events and routes it to every target registered for that type. Always returns 200: check `delivered` to see whether the bus accepted it. `delivered:true` means the bus ACCEPTED AND PERSISTED the event, never that a consumer received it: the Manager answers 200 even when a downstream target fails, and an unregistered type fans out to nobody.',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'type', 'payload', 'source'],
        properties: {
          credentials: {
            type: 'object',
            required: ['managerUrl', 'serviceKey'],
            properties: {
              managerUrl: {
                type: 'string',
                description: 'UmbeliumManager base URL, e.g. https://umbelium.com (no trailing /api)',
              },
              serviceKey: {
                type: 'string',
                description: 'Shared UMBELIUM_SERVICE_KEY, sent upstream as x-service-key',
              },
            },
          },
          type: {
            type: 'string',
            maxLength: 200,
            description: 'Event type, e.g. "post.published" or "contacts.discovered". Max 200 chars, no control characters. Unregistered types are persisted and marked delivered with no targets.',
          },
          payload: {
            description: 'Event data: any JSON value except null (objects and arrays are the convention).',
          },
          source: {
            type: 'string',
            maxLength: 200,
            description: 'Emitting service slug, e.g. "noesium", "socialum", "webum". Max 200 chars, no control characters.',
          },
          tenantId: {
            type: ['string', 'null'],
            description: 'Tenant scope. Sent upstream as tenant_id (snake_case). Defaults to null.',
          },
          tenant_id: {
            type: ['string', 'null'],
            description: 'Alias for tenantId, for drop-in migration from the apps local emitEvent() helpers.',
          },
          timeoutMs: { type: 'number', default: 5000, description: 'Upstream timeout, clamped to 500-30000' },
          retries: {
            type: 'number',
            default: 1,
            description:
              'Retries on 429/5xx/network, clamped to 0-3. The emit is NOT idempotent: a retry after the Manager persisted the event but failed the response duplicates it in umbelium_events. Pass 0 on hot paths (worst case with the defaults is ~11s before delivered:false).',
          },
        },
      },
    },
  ],
  router,
};
