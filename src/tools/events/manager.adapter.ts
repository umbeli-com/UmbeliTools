import { BaseAdapter } from '../../lib/baseAdapter';
import { AdapterError } from '../../lib/errors';
import type { EventsCredentials, EmitFailure, EmitResult } from './types';

export const EVENTS_PROVIDER = 'umbelium-manager';

const EMIT_PATH = '/api/events/emit';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp, but fall back to `fallback` for anything non-finite.
 *
 * `clamp(NaN, …)` returns NaN, and `new BaseAdapter({ timeout: NaN })` takes the
 * `|| 30000` branch — so a bogus `timeoutMs` silently bought a 30s hang instead
 * of the documented 5s. The route rejects a non-number with a 400; this covers
 * the direct callers of `emitEvent()`.
 */
function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max)
    : clamp(fallback, min, max);
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validate and normalise the caller-supplied Manager base URL.
 *
 * NEVER THROWS — it returns `{ error }` instead, because the two call sites
 * (the route, and `emitEvent` itself) must both stay on the `{ ok, … }` /
 * `delivered:false` path. Without it a bad URL reached `new URL()` deep inside
 * `BaseAdapter` and came back as `MANAGER_UNREACHABLE`, i.e. a caller typo was
 * reported as a bus outage.
 *
 * What it refuses:
 *  - a non-string or empty value (`.replace()` on a number threw a TypeError)
 *  - anything that is not an absolute http(s) URL (`file:`, `ftp:`, a bare host)
 *  - `user:pass@host`, whose credentials would otherwise be pasted into the
 *    AdapterError message — which this module writes to the server log.
 *
 * It also drops any query/hash and trailing slashes, so
 * `https://umbelium.com/?x=1` no longer builds `…/?x=1/api/events/emit`.
 */
export function checkManagerUrl(raw: unknown): { url: string } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: 'credentials.managerUrl must be a non-empty string' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: 'credentials.managerUrl must be an absolute URL, e.g. https://umbelium.com' };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { error: `credentials.managerUrl must use http: or https: (got ${parsed.protocol})` };
  }
  if (parsed.username || parsed.password) {
    return { error: 'credentials.managerUrl must not embed credentials (user:pass@host)' };
  }
  if (!parsed.hostname) {
    return { error: 'credentials.managerUrl has no host' };
  }
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

function classify(err: unknown): EmitFailure {
  if (err instanceof AdapterError) {
    return err.status
      ? {
          code: 'MANAGER_HTTP_ERROR',
          message: err.message,
          status: err.status,
          body: err.body,
        }
      : { code: 'MANAGER_UNREACHABLE', message: err.message };
  }
  return {
    code: 'MANAGER_UNREACHABLE',
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Fire-and-forget emit to the UmbeliumManager event bus.
 *
 * Wire contract copied verbatim from UmbeliumManager/backend/src/routes/events.routes.js:
 *   POST {managerUrl}/api/events/emit
 *   headers: x-service-key
 *   body:    { type, payload, source, tenant_id }   <- tenant_id is SNAKE_CASE upstream
 *   200:     { ok: true, eventId }
 *   400/401/500: { error }
 *
 * NEVER THROWS. A bus outage must not take down the caller's signup/publish flow,
 * so every upstream failure is swallowed, logged, and reported as delivered:false.
 */
export async function emitEvent(
  creds: EventsCredentials,
  input: {
    type: string;
    payload: unknown;
    source: string;
    tenantId?: string | null;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<EmitResult> {
  const tenantId = input.tenantId ?? null;

  const base: Omit<EmitResult, 'delivered' | 'eventId'> = {
    type: input.type,
    source: input.source,
    tenantId,
  };

  const checked = checkManagerUrl(creds?.managerUrl);
  if ('error' in checked) {
    const failure: EmitFailure = { code: 'MANAGER_URL_INVALID', message: checked.error };
    console.error(`[events] emit ${input.type} from ${input.source} not sent: ${failure.message}`);
    return { ...base, delivered: false, eventId: null, error: failure };
  }

  try {
    const adapter = new BaseAdapter({
      baseUrl: checked.url,
      defaultHeaders: { 'x-service-key': String(creds.serviceKey ?? '') },
      timeout: clampNumber(input.timeoutMs, DEFAULT_TIMEOUT_MS, 500, 30_000),
      retryConfig: { maxRetries: clampNumber(input.retries, DEFAULT_RETRIES, 0, 3) },
    });

    const { data } = await adapter.post(EMIT_PATH, {
      body: {
        type: input.type,
        payload: input.payload,
        source: input.source,
        tenant_id: tenantId,
      },
    });

    const parsed = (data ?? {}) as { ok?: boolean; eventId?: unknown; error?: string };

    // `umbelium_events.id` is whatever Supabase's PK is (uuid today, a bigint would
    // arrive as a JSON number). `EmitResult.eventId` promises `string | null`, so
    // coerce rather than let a number through a field typed as a string.
    const eventId =
      typeof parsed.eventId === 'string' || typeof parsed.eventId === 'number'
        ? String(parsed.eventId)
        : null;

    // The Manager answers 200 { ok: true, eventId }. Anything else on a 2xx is treated
    // as a non-delivery rather than a success we cannot prove.
    if (parsed.ok === false) {
      const failure: EmitFailure = {
        code: 'MANAGER_HTTP_ERROR',
        message: parsed.error || 'UmbeliumManager returned ok:false',
        status: 200,
        body: parsed,
      };
      console.error(`[events] emit ${input.type} from ${input.source} not accepted:`, failure.message);
      return { ...base, delivered: false, eventId: null, error: failure };
    }

    return { ...base, delivered: true, eventId };
  } catch (err) {
    const failure = classify(err);
    console.error(
      `[events] emit ${input.type} from ${input.source} failed (${failure.code}${
        failure.status ? ` ${failure.status}` : ''
      }): ${failure.message}`,
    );
    return { ...base, delivered: false, eventId: null, error: failure };
  }
}
