export interface UmbeliToolsClientOptions {
  /** Base URL of the UmbeliTools service, e.g. `http://umbelitools-api-prod:3002`. */
  url: string;
  /** Shared `UMBELIUM_SERVICE_KEY` value (sent as `x-service-key`). */
  serviceKey: string;
  /** Optional custom fetch (for tests, custom agents, etc.). */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds (no timeout if omitted). */
  timeoutMs?: number;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export interface ToolMeta {
  durationMs?: number;
  provider?: string;
  [key: string]: unknown;
}

export interface ToolResponse<TData = unknown> {
  data: TData;
  meta?: ToolMeta;
}

export class UmbeliToolsError extends Error {
  readonly name = 'UmbeliToolsError';
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
    public readonly meta?: ToolMeta,
  ) {
    super(message);
  }
}
