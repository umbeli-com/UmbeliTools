/**
 * The error vocabulary of the service.
 *
 * `ErrorCode` is the single list of machine-readable codes the API answers
 * with, and `ERROR_STATUS` pins each one to exactly one HTTP status. Before
 * this, the same class of failure came back differently depending on which
 * route you hit (`email/send` → 500 INTERNAL_ERROR, `email/smtp-send` → 502
 * PROVIDER_ERROR), so an SDK consumer could not branch on the code alone.
 *
 * Nothing here narrows an existing call site: `sendError()` still takes a plain
 * `string` code, so a route passing a literal keeps compiling. New code should
 * pass `ErrorCode.X` and let `statusForCode()` choose the status.
 */

/**
 * Every code the service is allowed to answer with.
 *
 * 4xx = the caller can fix it. 5xx = we or an upstream broke.
 */
export enum ErrorCode {
  // ---- 400: the request itself is wrong -------------------------------
  MISSING_FIELDS = 'MISSING_FIELDS',
  MISSING_CREDENTIALS = 'MISSING_CREDENTIALS',
  INVALID_FIELD = 'INVALID_FIELD',
  /** Body was not valid JSON — raised by `express.json()`, not by a route. */
  INVALID_JSON = 'INVALID_JSON',
  /** The tool exists, this action does not support what was asked. */
  UNSUPPORTED_ACTION = 'UNSUPPORTED_ACTION',

  // ---- 401 / 403 / 404 / 405 ------------------------------------------
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  /** Unknown tool or unknown action. */
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  /** Body was not JSON (or an unsupported charset/encoding). */
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  /** The client hung up before the body finished arriving. */
  REQUEST_ABORTED = 'REQUEST_ABORTED',

  // ---- 413 / 429 -------------------------------------------------------
  /** Request body exceeded the app-level parser cap. */
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  /** An uploaded file exceeded a tool's own cap (storage). */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  RATE_LIMIT = 'RATE_LIMIT',

  // ---- 5xx -------------------------------------------------------------
  /** The service is misconfigured — never the caller's fault. */
  CONFIG_ERROR = 'CONFIG_ERROR',
  /** An unexpected throw inside the service. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** A third-party API refused, errored, or answered nonsense. */
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  /** Upstream-specific flavours of PROVIDER_ERROR, kept for compatibility. */
  WEBHOOK_FAILED = 'WEBHOOK_FAILED',
  INBOX_FAILED = 'INBOX_FAILED',
  FETCH_ERROR = 'FETCH_ERROR',
  /** An upstream call ran out of time. */
  TIMEOUT = 'TIMEOUT',
}

/** The one true code → status mapping. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.MISSING_FIELDS]: 400,
  [ErrorCode.MISSING_CREDENTIALS]: 400,
  [ErrorCode.INVALID_FIELD]: 400,
  [ErrorCode.INVALID_JSON]: 400,
  [ErrorCode.UNSUPPORTED_ACTION]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ErrorCode.REQUEST_ABORTED]: 400,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.CONFIG_ERROR]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.PROVIDER_ERROR]: 502,
  [ErrorCode.WEBHOOK_FAILED]: 502,
  [ErrorCode.INBOX_FAILED]: 502,
  [ErrorCode.FETCH_ERROR]: 502,
  [ErrorCode.TIMEOUT]: 504,
};

/** True when `code` is one this service publishes. */
export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_STATUS, code);
}

/** The status a code must be answered with, or `fallback` for an unknown one. */
export function statusForCode(code: string, fallback = 500): number {
  return isKnownErrorCode(code) ? ERROR_STATUS[code] : fallback;
}

/**
 * A third-party HTTP call failed. Thrown by `BaseAdapter` (see
 * `src/lib/baseAdapter.ts`), which owns the retry/backoff policy.
 */
export class AdapterError extends Error {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  retryable: boolean;

  constructor(
    message: string,
    opts: {
      status?: number;
      body?: unknown;
      headers?: Record<string, string>;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'AdapterError';
    this.status = opts.status;
    this.body = opts.body;
    this.headers = opts.headers;
    this.retryable = opts.retryable ?? false;
  }
}

/**
 * A tool refused the request on its own terms — a missing field, an unknown
 * provider, a content block the API cannot represent.
 *
 * KEPT, not deleted: `src/tools/ai/*` throws it from deep inside validation
 * (`content.ts`, `gemini.adapter.ts`) and `ai/index.ts` catches it, and the
 * error middleware in `src/middleware/error.middleware.ts` now turns any
 * ToolError that escapes a route into the same `{ ok: false }` envelope. That
 * makes `throw new ToolError(...)` a legitimate way to fail out of a helper
 * without threading `res` through it.
 *
 * `status` is derived from the code (defaulting to 400, since a ToolError is a
 * validation failure by nature) unless the caller pins one.
 */
export class ToolError extends Error {
  code: string;
  details?: unknown;
  /** HTTP status this error should be answered with. */
  readonly status: number;

  constructor(code: string, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
    this.status = status ?? statusForCode(code, 400);
    Object.setPrototypeOf(this, ToolError.prototype);
  }
}
