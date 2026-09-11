/**
 * The `{ ok, … }` envelope every route answers with, and the only two helpers
 * allowed to write it.
 *
 * The SDK (`client/src/client.ts`) parses exactly this shape, so the envelope
 * is a published contract: `sendSuccess(res, data, meta?)` and
 * `sendError(res, status, code, message, details?, meta?)` keep their existing
 * signatures forever.
 */

import type { Response } from 'express';
import { ErrorCode, statusForCode } from './errors';

export interface ToolMeta {
  durationMs?: number;
  provider?: string;
  [key: string]: unknown;
}

/** What `sendSuccess()` puts on the wire. `meta` is absent when not supplied. */
export interface ToolSuccess<TData = unknown> {
  ok: true;
  data: TData;
  meta?: ToolMeta;
}

/** What `sendError()` puts on the wire. */
export interface ToolFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  meta?: ToolMeta;
}

/**
 * A response body from this service.
 *
 * It used to be a single interface with every field optional, which described
 * a body that could carry `data` AND `error` at once — something the service
 * never sends. As a union, `if (body.ok)` now narrows to the real shape, and it
 * matches `ServerResponse` in the SDK one-for-one.
 */
export type ToolResult<TData = unknown> = ToolSuccess<TData> | ToolFailure;

/** Build a success envelope without a Response — handy in tests. */
export function successBody<TData>(data: TData, meta?: Record<string, unknown>): ToolSuccess<TData> {
  // `meta` is omitted, not set to undefined: that is what reaches the wire,
  // since JSON.stringify drops undefined properties.
  return meta ? { ok: true, data, meta: meta as ToolMeta } : { ok: true, data };
}

/** Build an error envelope without a Response — handy in tests. */
export function errorBody(
  code: string,
  message: string,
  details?: unknown,
  meta?: Record<string, unknown>,
): ToolFailure {
  const error: ToolFailure['error'] = { code, message };
  if (details !== undefined) error.details = details;
  const body: ToolFailure = { ok: false, error };
  if (meta) body.meta = meta as ToolMeta;
  return body;
}

export function sendSuccess(res: Response, data: unknown, meta?: Record<string, unknown>) {
  res.json({ ok: true, data, meta });
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
  meta?: Record<string, unknown>,
) {
  const error: Record<string, unknown> = { code, message };
  if (details) error.details = details;
  const body: Record<string, unknown> = { ok: false, error };
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
}

/**
 * `sendError` with the status taken from `ERROR_STATUS` instead of hand-picked
 * at the call site — the way to keep two routes from answering the same code
 * with two different statuses. Prefer this in new code.
 */
export function sendCodedError(
  res: Response,
  code: ErrorCode,
  message: string,
  details?: unknown,
  meta?: Record<string, unknown>,
) {
  sendError(res, statusForCode(code), code, message, details, meta);
}
