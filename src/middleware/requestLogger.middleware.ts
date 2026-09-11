/**
 * One line per request — now with the two things it was missing: WHO called,
 * and an id to quote when they ask why a call failed.
 *
 * `x-request-id` is echoed back on the response, so a caller that already
 * generates one (nginx-proxy, or an app's own middleware) keeps its trace, and
 * one that does not gets an id it can read off the response header.
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { clientIp } from './serviceKey.middleware';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id, taken from `x-request-id` or generated. */
      requestId?: string;
    }
  }
}

/** A caller-supplied id is only echoed if it is short and printable. */
function safeIncomingId(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

export function createRequestLogger(
  log: (line: string) => void = (line) => console.log(line),
): RequestHandler {
  return function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const requestId = safeIncomingId(req.headers['x-request-id']) ?? crypto.randomUUID().slice(0, 8);
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const ms = Date.now() - start;
      // `req.caller` is set by serviceKeyMiddleware, which runs after this —
      // by the time 'finish' fires it is there for every authenticated call.
      const caller = req.caller?.name ?? 'anonymous';
      log(
        `[${req.method}] ${req.originalUrl} → ${res.statusCode} (${ms}ms) caller=${caller} ip=${clientIp(req)} rid=${requestId}`,
      );
    });

    next();
  };
}

/** Default logger — same name and same shape as before. */
export const requestLogger: RequestHandler = createRequestLogger();
