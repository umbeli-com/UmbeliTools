import type { Response } from 'express';

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  meta?: { durationMs: number; provider?: string; [key: string]: unknown };
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
