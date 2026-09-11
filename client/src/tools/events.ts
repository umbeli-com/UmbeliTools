import { UmbeliToolsCore } from '../client.js';
import { UmbeliToolsError } from '../types.js';

export interface EventsCredentials {
  /** UmbeliumManager base URL, e.g. `https://umbelium.com` (no trailing `/api`). */
  managerUrl: string;
  /** Shared `UMBELIUM_SERVICE_KEY`, forwarded upstream as `x-service-key`. */
  serviceKey: string;
}

export interface EventsEmitInput {
  credentials: EventsCredentials;
  /** Event type, e.g. `post.published`, `contacts.discovered`. */
  type: string;
  /** Event data. Must not be null. */
  payload: unknown;
  /** Emitting service slug, e.g. `noesium`, `socialum`, `webum`. */
  source: string;
  /** Tenant scope. Sent to the Manager as `tenant_id`. */
  tenantId?: string | null;
  /** Alias for `tenantId`, for drop-in migration from the apps' local `emitEvent()` helpers. */
  tenant_id?: string | null;
  /** Upstream timeout in ms. Default 5000, clamped to 500-30000. */
  timeoutMs?: number;
  /** Retries on 429/5xx/network. Default 1, clamped to 0-3. */
  retries?: number;
}

export type EventsEmitFailureCode =
  | 'MANAGER_HTTP_ERROR'
  | 'MANAGER_UNREACHABLE'
  /** `credentials.managerUrl` is not a usable http(s) base URL — a caller config error. */
  | 'MANAGER_URL_INVALID'
  /**
   * The failure happened between this process and UmbeliTools — the toolbox was
   * unreachable, timed out, or refused the input (400). The Manager was never
   * reached, so this must NOT be alerted on as a bus outage.
   */
  | 'TOOLBOX_ERROR';

export interface EventsEmitFailure {
  code: EventsEmitFailureCode;
  message: string;
  /** Upstream status when the Manager answered (400 bad event, 401 bad service key, 500 bus error). */
  status?: number;
  body?: unknown;
}

export interface EventsEmitResult {
  /**
   * `true` means the bus ACCEPTED AND PERSISTED the event — never that a consumer
   * received it. The Manager answers 200 even when a downstream target fails, and
   * an event type absent from its registry fans out to nobody.
   *
   * `false` means the bus did not accept it. The call still succeeds.
   */
  delivered: boolean;
  /** `umbelium_events.id` from the Manager, `null` when delivery failed. */
  eventId: string | null;
  type: string;
  source: string;
  tenantId: string | null;
  /** Present only when `delivered` is false. */
  error?: EventsEmitFailure;
}

/**
 * Shape returned by `emitSafe` when the call never got past UmbeliTools.
 *
 * The code is `TOOLBOX_ERROR`, not `MANAGER_UNREACHABLE`: this branch also
 * catches a 400 on our own input, and reporting that as the event bus being
 * down sends whoever is on call to the wrong service. The toolbox's own code
 * (`MISSING_FIELDS`, `INVALID_FIELD`, `TIMEOUT`, …) is kept in `body.toolCode`.
 */
const toolboxFailure = (input: EventsEmitInput, err: unknown): EventsEmitResult => {
  const message = err instanceof Error ? err.message : String(err);
  const toolError = err instanceof UmbeliToolsError ? err : null;
  return {
    delivered: false,
    eventId: null,
    type: input.type,
    source: input.source,
    tenantId: input.tenantId ?? input.tenant_id ?? null,
    error: {
      code: 'TOOLBOX_ERROR',
      message,
      ...(toolError?.status !== undefined ? { status: toolError.status } : {}),
      ...(toolError ? { body: { toolCode: toolError.code, details: toolError.details } } : {}),
    },
  };
};

export class EventsTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /**
   * Emit a cross-service event to the UmbeliumManager bus.
   *
   * The server never returns 502 for a bus outage — it returns `delivered: false`.
   * This method still rejects if the *toolbox itself* is unreachable or the input is
   * rejected (400). In a user-facing request path prefer {@link emitSafe}.
   */
  emit(input: EventsEmitInput) {
    return this.core.request<EventsEmitResult>('events', 'emit', input);
  }

  /**
   * Drop-in replacement for the apps' local `emitEvent()` helper: never rejects,
   * for any reason, including UmbeliTools being down or the input being rejected.
   * Inspect `delivered` / `error` on the returned result.
   */
  async emitSafe(input: EventsEmitInput): Promise<EventsEmitResult> {
    try {
      return await this.emit(input);
    } catch (err) {
      const result = toolboxFailure(input, err);
      // eslint-disable-next-line no-console
      console.error(
        `[events] emitSafe ${input.type} from ${input.source} failed: ${result.error?.message}`,
      );
      return result;
    }
  }
}
