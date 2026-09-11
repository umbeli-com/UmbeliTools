/**
 * The two terminal middlewares: unknown route, and anything that throws.
 *
 * WHAT THIS FIXES: until now the service had no error-handling middleware at
 * all, so three very common cases fell through to Express's default handler and
 * came back as an HTML page —
 *
 *   • an unknown tool or action  → `<pre>Cannot POST /api/tools/emai/send</pre>`
 *   • a malformed JSON body      → `<pre>SyntaxError: Unexpected token …</pre>`
 *   • any throw outside a route's own try/catch (a sync throw before the
 *     `try`, a rejected promise a handler forgot to await)
 *
 * Every one of those reaches the SDK, which does `res.json()`, gets null, and
 * reports `HTTP_ERROR` with no code and no message. The envelope is a contract:
 * a 404 and a 500 must be `{ ok: false, error: { code, message } }` too.
 *
 * `ToolError` is the reason this file can be strict. It used to be dead code;
 * it is now the way a helper deep inside a tool fails without threading `res`
 * through every call — throw it, and this handler renders it with the right
 * status and code.
 */

import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { AdapterError, ErrorCode, ToolError, statusForCode } from '../lib/errors';
import { sendError } from '../lib/response';

/** body-parser / raw-body failure types → our vocabulary. */
const BODY_PARSER_CODES: Record<string, ErrorCode> = {
  'entity.parse.failed': ErrorCode.INVALID_JSON,
  'entity.verify.failed': ErrorCode.INVALID_JSON,
  'entity.too.large': ErrorCode.PAYLOAD_TOO_LARGE,
  'parameters.too.many': ErrorCode.PAYLOAD_TOO_LARGE,
  'request.size.invalid': ErrorCode.INVALID_FIELD,
  'request.aborted': ErrorCode.REQUEST_ABORTED,
  'encoding.unsupported': ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  'charset.unsupported': ErrorCode.UNSUPPORTED_MEDIA_TYPE,
};

interface HttpishError {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
  message?: unknown;
}

function httpStatusOf(err: unknown): number | null {
  const e = err as HttpishError;
  const raw = typeof e?.status === 'number' ? e.status : e?.statusCode;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 400 && raw <= 599 ? raw : null;
}

/** What the caller should be told, and with which code/status. */
export interface ClassifiedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  /** Worth a stack trace in the log. */
  serverFault: boolean;
}

/**
 * Turn anything that was thrown into the envelope's three fields. Exported so
 * the tests can assert the mapping without standing up an HTTP server.
 *
 * `exposeInternals` controls one thing only: whether the raw message of an
 * UNEXPECTED 5xx reaches the caller. In production it must not — an unhandled
 * throw is exactly where a connection string or a provider token ends up in a
 * message.
 */
export function classifyError(err: unknown, exposeInternals: boolean): ClassifiedError {
  // 1. Thrown on purpose by a tool: the message was written for the caller.
  if (err instanceof ToolError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
      serverFault: err.status >= 500,
    };
  }

  // 2. A third-party API failed inside an adapter and nobody caught it.
  if (err instanceof AdapterError) {
    return {
      status: statusForCode(ErrorCode.PROVIDER_ERROR),
      code: ErrorCode.PROVIDER_ERROR,
      message: err.message,
      // The upstream STATUS is safe and useful; the upstream BODY is not — it
      // can echo back the Authorization header the adapter just sent.
      details: err.status ? { providerStatus: err.status } : undefined,
      serverFault: false,
    };
  }

  // 3. express.json() / express.raw() rejected the body.
  const type = (err as HttpishError)?.type;
  if (typeof type === 'string' && BODY_PARSER_CODES[type]) {
    const code = BODY_PARSER_CODES[type]!;
    return {
      status: httpStatusOf(err) ?? statusForCode(code, 400),
      code,
      // body-parser messages are already caller-safe ("Unexpected token } in
      // JSON at position 42") and are the only clue a caller gets.
      message: String((err as HttpishError).message ?? 'Malformed request body'),
      serverFault: false,
    };
  }

  // 4. Anything else carrying an HTTP status (http-errors, and friends).
  const status = httpStatusOf(err) ?? 500;
  const rawMessage = err instanceof Error ? err.message : String(err);

  if (status < 500) {
    return { status, code: ErrorCode.INVALID_FIELD, message: rawMessage, serverFault: false };
  }

  return {
    status,
    code: ErrorCode.INTERNAL_ERROR,
    message: exposeInternals ? rawMessage : 'Internal server error',
    serverFault: true,
  };
}

export interface ErrorHandlerOptions {
  /** Default: `console.error`. */
  logger?: (err: unknown, req: Request) => void;
  /** Return raw 5xx messages. Default: everywhere but production. */
  exposeInternals?: boolean;
}

/**
 * Express error-handling middleware.
 *
 * MUST be mounted last and MUST keep all four parameters: Express identifies an
 * error handler by `fn.length === 4` alone, so dropping the unused `next` turns
 * this silently back into a normal middleware that never runs.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const expose = options.exposeInternals ?? process.env.NODE_ENV !== 'production';
  const log =
    options.logger ??
    ((err: unknown, req: Request) => {
      const caller = req.caller?.name ?? 'anonymous';
      console.error(`[error] ${req.method} ${req.originalUrl || req.url} caller=${caller} —`, err);
    });

  return function toolsErrorHandler(
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const classified = classifyError(err, expose);

    if (classified.serverFault) log(err, req);

    // The response already started (a stream broke mid-body): only Express's
    // own handler can destroy the socket correctly from here.
    if (res.headersSent) {
      next(err);
      return;
    }

    sendError(res, classified.status, classified.code, classified.message, classified.details, {
      caller: req.caller?.name,
    });
  };
}

/**
 * Terminal 404 — mount after every router, before `errorHandler()`.
 *
 * A typo in a tool or action name is the single most common integration
 * mistake, so the message names both and points at the catalogue endpoint.
 */
export function notFoundHandler(): RequestHandler {
  return function toolsNotFound(req: Request, res: Response) {
    const path = req.originalUrl || req.url;
    const match = /^\/api\/tools\/([^/?]+)(?:\/([^/?]+))?/.exec(path);

    let message: string;
    if (match) {
      const [, tool, action] = match;
      message = action
        ? `Unknown tool action "${tool}/${action}". Call GET /api/tools for the catalogue of tools, actions and input schemas.`
        : `Unknown tool "${tool}". Call GET /api/tools for the catalogue of tools, actions and input schemas.`;
      if (req.method !== 'POST') {
        message += ` (tool actions are POST; this request was ${req.method}.)`;
      }
    } else {
      message = `No route for ${req.method} ${path}. Tool actions live at POST /api/tools/<tool>/<action>; GET /api/tools lists them.`;
    }

    sendError(res, statusForCode(ErrorCode.NOT_FOUND), ErrorCode.NOT_FOUND, message);
  };
}
