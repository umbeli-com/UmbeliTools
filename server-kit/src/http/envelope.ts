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

export interface ErrorHandlerOptions {
  /** Called for every error before the response. Default: `console.error`. */
  logger?: (err: unknown, req: Request) => void;
  /**
   * Return the raw message + stack of NON-operational errors. Default: false in
   * production (`NODE_ENV === 'production'`), true elsewhere.
   */
  exposeInternals?: boolean;
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
      sendError(
        res,
        err.statusCode,
        err.code,
        err.message,
        err.details,
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

    const status = statusOf(err) ?? 500;
    const message =
      status < 500 || expose
        ? (err as Error)?.message || 'Internal server error'
        : 'Internal server error';
    const details =
      expose && err instanceof Error && err.stack ? { stack: err.stack } : undefined;

    sendError(res, status, codeOf(err, status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'), message, details);
  };
}

/** Terminal 404. Mount after every router, before `errorHandler()`. */
export function notFoundHandler(): RequestHandler {
  return function serverKitNotFound(req, res) {
    sendError(
      res,
      404,
      'NOT_FOUND',
      `Route not found: ${req.method} ${safeUrl(req)}`,
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
  errorHandler,
  notFoundHandler,
} as const;
