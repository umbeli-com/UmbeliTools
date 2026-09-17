/**
 * The response envelope + the two terminal middlewares.
 *
 * Envelope shape is Profilum's (`{ success, data }` / `{ success, error: {
 * message, code } }`) — the one the suite's newer frontends already parse.
 * Argument ORDER is UmbeliTools' (`sendError(res, status, code, message)`), so
 * a route written in this repo reads the same whether it uses the service's own
 * `src/lib/response.ts` or this package.
 *
 * NOTE for adopters: UmbeliTools the SERVICE answers `{ ok, data }`. This
 * package answers `{ success, data }`. Do not mix them in one API surface.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  isAppError,
} from './errors.js';

export interface SuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  success: false;
  error: { message: string; code: string; details?: unknown };
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/** Build a success envelope (no Response needed — handy in tests and services). */
export function ok<T>(data: T, meta?: Record<string, unknown>): SuccessEnvelope<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

/** Build an error envelope. */
export function fail(
  message: string,
  code = 'INTERNAL_ERROR',
  details?: unknown,
): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = { message, code };
  if (details !== undefined) error.details = details;
  return { success: false, error };
}

/** `res.json({ success: true, data, meta })`. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>,
  statusCode = 200,
): Response {
  return res.status(statusCode).json(ok(data, meta));
}

/** `res.status(status).json({ success: false, error: { message, code } })`. */
export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return res.status(statusCode).json(fail(message, code, details));
}

// ── Response shape, per app ─────────────────────────────────────────────
/**
 * WHY THIS EXISTS.
 *
 * The envelope above is the kit's shape, and it is the shape of the suite's
 * newer frontends. It is NOT the shape of the older ones, and that single fact
 * is what kept three backends off this package:
 *
 *   - Webum's admin reads `body?.error || body?.message` (`managerBilling.ts`).
 *     Against `{ success:false, error:{ message, code } }`, `body.error` is a
 *     truthy OBJECT — the user is shown « [object Object] ». Neither the build
 *     nor the typecheck sees it, so Webum took `bearerToken()` alone and left
 *     `supabaseBearerAuth()` on the shelf.
 *   - Servum refused `errorKit` for the same reason, and had to teach
 *     `apps/web/src/lib/api.ts` to un-tangle BOTH shapes once the kit's rate
 *     limiter started answering in the envelope next to its hand-written
 *     `{ error }` routes.
 *   - Profilum's `utils/response.js` already emits the envelope — it is the
 *     backend the shape came from.
 *
 * So the shape becomes an argument. `envelopeErrorFormat` stays the default and
 * nothing moves for anyone already on it; an app that answers `{ error }` today
 * passes `errorFormats.flat` and adopts the guards without its clients seeing a
 * single different byte.
 *
 * Only ERRORS are formattable. Success bodies are not: `ok()`/`sendSuccess()`
 * are opt-in per call site, so an app that never calls them is never affected,
 * whereas an error body is written by middleware the app does not control.
 */

/** What the kit decided, before it is turned into a body. */
export interface ErrorPayload {
  /** HTTP status the kit chose for this error. */
  status: number;
  /** Stable machine code (`UNAUTHORIZED`, `RATE_LIMIT`, `NOT_FOUND`…). */
  code: string;
  /** Human-readable message, already safe to send (internals stripped). */
  message: string;
  /** Extra context, only ever present when the caller is allowed to see it. */
  details?: unknown;
}

/** Turns the kit's decision into the JSON body the client receives. */
export type ErrorFormat = (payload: ErrorPayload) => unknown;

/** Mixed into every option bag that can answer an error. */
export interface ErrorFormatOption {
  /**
   * Body shape for errors this middleware answers itself.
   * Default: `errorFormats.envelope` — the kit shape. Unchanged unless set.
   */
  format?: ErrorFormat;
}

/** The kit shape: `{ success:false, error:{ message, code, details? } }`. */
export const envelopeErrorFormat: ErrorFormat = ({ message, code, details }) =>
  fail(message, code, details);

/**
 * `{ error: "message" }` — what Webum, Servum and the Manager's older routes
 * answer today. Deliberately nothing else: no code, no details, no stack. A
 * client that reads `body.error` as a string keeps reading a string, and the
 * body is byte-identical to the hand-written `res.status(401).json({ error })`
 * it replaces.
 */
export const flatErrorFormat: ErrorFormat = ({ message }) => ({ error: message });

/** The ready-made shapes. Anything else is just a function of `ErrorPayload`. */
export const errorFormats = {
  /** Default — `{ success:false, error:{ message, code } }`. */
  envelope: envelopeErrorFormat,
  /** `{ error: "message" }`. */
  flat: flatErrorFormat,
} as const;

/**
 * Write an error through a format. The single choke point every guard, the
 * rate limiter and both terminal handlers go through.
 *
 * A throwing or empty formatter falls back to the kit envelope instead of
 * propagating: this runs inside `errorHandler()`, where there is no next
 * handler left to catch anything — a throw here would hang the request.
 */
export function respondError(
  res: Response,
  payload: ErrorPayload,
  format: ErrorFormat = envelopeErrorFormat,
): Response {
  let body: unknown;
  try {
    body = format(payload);
    // `null` is rejected alongside `undefined` on purpose: `res.json(null)`
    // answers the four bytes `null` with the error status, and every client in
    // the suite reads `body.error` — which throws on the client instead.
    if (body === undefined || body === null) {
      throw new TypeError('format returned no body');
    }
  } catch (err) {
    console.error('[server-kit] error format threw; falling back to the envelope:', err);
    body = envelopeErrorFormat(payload);
  }
  // A status Express refuses (`res.status()` throws on a non-integer or an
  // out-of-range code in Express 5) would throw HERE — inside the terminal
  // handler, where the throw becomes a dead socket. An error is never a 2xx
  // either, so anything nonsensical answers 500 rather than a silent success.
  const status =
    Number.isInteger(payload.status) && payload.status >= 400 && payload.status <= 599
      ? payload.status
      : 500;
  return res.status(status).json(body);
}

export interface ErrorHandlerOptions extends ErrorFormatOption {
  /** Called for every error before the response. Default: `console.error`. */
  logger?: (err: unknown, req: Request) => void;
  /**
   * Return the raw message + stack of NON-operational errors. Default: false in
   * production (`NODE_ENV === 'production'`), true elsewhere.
   */
  exposeInternals?: boolean;
  /**
   * Treat errors that are NOT AppErrors as opaque (default: false).
   *
   * By default a third-party error is read for what it carries: its status
   * (`err.status` or `err.statusCode`), its code (`err.code` / `err.type`),
   * its message for a 4xx, and its stack when internals are exposed. That is
   * right for an API that wants `413 ENTITY_TOO_LARGE` to reach the caller —
   * and wrong for one whose contract is « only AppErrors speak »:
   *
   * Measured on Profilum's backend (19 real errors from body-parser, multer, pg
   * and openai, NODE_ENV=production) — only 9/19 identical: an OpenAI
   * AuthenticationError (`status: 401`, thrown on /api/ai/analyze) answered 500
   * and would answer 401; `pg 22P02`, `MulterError LIMIT_FILE_SIZE` or
   * `ENTITY_TOO_LARGE` leaked as the code; 'request entity too large' replaced
   * 'Internal server error' in production (asserted by its e2e api-security).
   *
   * With `true`, a non-AppError answers: status from `err.statusCode` ONLY
   * (integer 400–599, else 500 — never `err.status`), code `INTERNAL_ERROR`,
   * message `err.message` only when internals are exposed (else
   * 'Internal server error', for a 4xx too), and no `details`. AppErrors are
   * unaffected.
   */
  opaqueThirdPartyErrors?: boolean;
}

/**
 * Query parameters whose VALUE is a credential. `supabaseBearerAuth({
 * allowQueryToken: true })` exists for EventSource and download links, which
 * cannot set a header — so a live JWT really does sit in `req.originalUrl` on
 * those routes, and neither a log line nor a 404 body may copy it.
 */
const SECRET_QUERY_PARAM =
  /^(token|access_token|refresh_token|id_token|jwt|api_?key|service_?key|secret|password|signature|sig)$/i;

/** `/stream?token=eyJhbG…` → `/stream?token=REDACTED`. */
function safeUrl(req: Request): string {
  const raw = req.originalUrl || req.url || '';
  const split = raw.indexOf('?');
  if (split === -1) return raw;
  const query = raw
    .slice(split + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const name = pair.slice(0, eq);
      return SECRET_QUERY_PARAM.test(name) ? `${name}=REDACTED` : pair;
    })
    .join('&');
  return `${raw.slice(0, split)}?${query}`;
}

/** Status carried by third-party errors (body-parser, multer, http-errors…). */
function statusOf(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown };
  const raw = typeof e?.status === 'number' ? e.status : e?.statusCode;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 400 && raw <= 599 ? raw : null;
}

function codeOf(err: unknown, fallback: string): string {
  const e = err as { code?: unknown; type?: unknown };
  if (typeof e?.code === 'string' && e.code) return e.code.toUpperCase();
  if (typeof e?.type === 'string' && e.type) return e.type.toUpperCase().replace(/\./g, '_');
  return fallback;
}

/**
 * Express error-handling middleware. MUST be mounted last, and MUST keep its
 * four parameters — Express detects an error handler by arity alone.
 */
export function errorHandler(options: ErrorHandlerOptions = {}) {
  const expose =
    options.exposeInternals ?? process.env.NODE_ENV !== 'production';
  const format = options.format ?? envelopeErrorFormat;
  const opaque = options.opaqueThirdPartyErrors === true;
  const log =
    options.logger ??
    ((err: unknown, req: Request) => {
      console.error(`[error] ${req.method} ${safeUrl(req)} —`, err);
    });

  return function serverKitErrorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    if (isAppError(err)) {
      // Operational: the message was written for the caller.
      if ((err as AppError).statusCode >= 500) log(err, req);
      respondError(
        res,
        {
          status: err.statusCode,
          code: err.code,
          message: err.message,
          details: err.details,
        },
        format,
      );
      return;
    }

    log(err, req);

    // Headers already flushed (a stream broke mid-response): Express's default
    // handler is the only thing that can close this connection correctly.
    if (res.headersSent) {
      _next(err);
      return;
    }

    if (opaque) {
      const raw = (err as { statusCode?: unknown } | null | undefined)?.statusCode;
      const status =
        typeof raw === 'number' && Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
      respondError(
        res,
        {
          status,
          code: 'INTERNAL_ERROR',
          message: expose ? (err as Error)?.message || 'Internal server error' : 'Internal server error',
        },
        format,
      );
      return;
    }

    const status = statusOf(err) ?? 500;
    const message =
      status < 500 || expose
        ? (err as Error)?.message || 'Internal server error'
        : 'Internal server error';
    const details =
      expose && err instanceof Error && err.stack ? { stack: err.stack } : undefined;

    respondError(
      res,
      {
        status,
        code: codeOf(err, status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
        message,
        details,
      },
      format,
    );
  };
}

export interface NotFoundHandlerOptions extends ErrorFormatOption {
  /**
   * Message for the 404. Receives the REDACTED url (`?token=` never reaches
   * it). Default: `Route not found: GET /nope`.
   */
  message?: (req: Request) => string;
}

/** Terminal 404. Mount after every router, before `errorHandler()`. */
export function notFoundHandler(options: NotFoundHandlerOptions = {}): RequestHandler {
  const format = options.format ?? envelopeErrorFormat;
  const message =
    options.message ?? ((req: Request) => `Route not found: ${req.method} ${safeUrl(req)}`);
  return function serverKitNotFound(req, res) {
    respondError(
      res,
      { status: 404, code: 'NOT_FOUND', message: message(req) },
      format,
    );
  };
}

/** Everything error-shaped, grouped — `import { errorKit } from '@umbeli-com/server-kit'`. */
export const errorKit = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  isAppError,
  ok,
  fail,
  sendSuccess,
  sendError,
  respondError,
  errorFormats,
  envelopeErrorFormat,
  flatErrorFormat,
  errorHandler,
  notFoundHandler,
} as const;
