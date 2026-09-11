export interface EventsCredentials {
  /** Base URL of UmbeliumManager, e.g. `https://umbelium.com` or `http://umbelium-backend-prod:3001`. */
  managerUrl: string;
  /** Shared UMBELIUM_SERVICE_KEY value, sent to the Manager as `x-service-key`. */
  serviceKey: string;
}

export interface EventsEmitInput {
  credentials: EventsCredentials;
  /** Event type, e.g. `post.published`, `contacts.discovered`. Must exist in the Manager event-registry to be routed. */
  type: string;
  /** Event data. The Manager rejects null/undefined payloads. */
  payload: unknown;
  /** Emitting service slug, e.g. `noesium`, `socialum`, `webum`. */
  source: string;
  /** Tenant scope. Sent to the Manager as `tenant_id`. */
  tenantId?: string | null;
  /** Alias for `tenantId`, for drop-in migration from the apps' local emitEvent() helpers. */
  tenant_id?: string | null;
  /** Upstream timeout in ms. Default 5000, clamped to 500-30000. */
  timeoutMs?: number;
  /** Retries on 429/5xx/network. Default 1, clamped to 0-3. */
  retries?: number;
}

export type EmitFailureCode =
  | 'MANAGER_HTTP_ERROR'
  | 'MANAGER_UNREACHABLE'
  /** `credentials.managerUrl` is not a usable http(s) base URL — a caller config error, not a bus outage. */
  | 'MANAGER_URL_INVALID';

export interface EmitFailure {
  code: EmitFailureCode;
  message: string;
  /** Upstream HTTP status when the Manager answered (400 bad event, 401 bad service key, 500 bus error). */
  status?: number;
  /** Upstream response body when the Manager answered. */
  body?: unknown;
}

export interface EmitResult {
  /**
   * true means the bus ACCEPTED AND PERSISTED the event — never that a consumer
   * received it: the Manager answers 200 { ok:true } even when routing to a
   * downstream target fails, and an unregistered type fans out to nobody.
   *
   * false means the bus did not accept it. The endpoint still returns 200.
   */
  delivered: boolean;
  /** `umbelium_events.id` returned by the Manager, null when delivery failed. */
  eventId: string | null;
  type: string;
  source: string;
  tenantId: string | null;
  /** Present only when `delivered` is false. */
  error?: EmitFailure;
}
