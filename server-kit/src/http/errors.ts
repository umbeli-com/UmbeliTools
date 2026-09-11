/**
 * The error classes every Umbeli backend re-declares.
 *
 * Reconciled from Profilum (`backend/src/utils/errors.js`) — the version that
 * already pairs with the `{ success, error: { message, code } }` envelope — with
 * `details` added so a validation failure can carry its field list, and
 * `expose` so the handler knows which messages are safe to show a caller.
 */

/**
 * Cross-realm brand. `instanceof` is FALSE between the CJS and the ESM copy of
 * this package — the dual-package hazard — so an `AppError` thrown by a library
 * that imported the ESM build would reach a consumer's CJS `errorHandler()` as
 * an unknown error: 500, message hidden in production, status/code discarded.
 * A `Symbol.for` key is shared by every copy in the process, so the check below
 * survives that split (and a consumer that ships its OWN AppError class is
 * unaffected — it does not carry this brand).
 */
const APP_ERROR_BRAND: unique symbol = Symbol.for('@umbeli-com/server-kit.AppError');

export class AppError extends Error {
  /** @internal cross-copy marker — see APP_ERROR_BRAND. Non-enumerable in JSON. */
  readonly [APP_ERROR_BRAND] = true;
  /** HTTP status to answer with. */
  readonly statusCode: number;
  /** Stable machine-readable code, e.g. `NOT_FOUND`. */
  readonly code: string;
  /** Optional payload (validation errors, upstream body…). */
  readonly details?: unknown;
  /** Thrown on purpose — the message is safe to return to the caller. */
  readonly isOperational = true;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Restores the prototype chain under `target: ES5`-style downlevelling, so
    // `err instanceof AppError` holds in a consumer compiled to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', details?: unknown) {
    super(message, 429, 'RATE_LIMIT', details);
  }
}

/** True for an error this kit (or a consumer) threw on purpose. */
export function isAppError(err: unknown): err is AppError {
  if (err instanceof AppError) return true;
  // A copy of this class from the OTHER build output in the same process.
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { [APP_ERROR_BRAND]?: unknown; statusCode?: unknown; code?: unknown };
  return (
    e[APP_ERROR_BRAND] === true &&
    typeof e.statusCode === 'number' &&
    typeof e.code === 'string'
  );
}
