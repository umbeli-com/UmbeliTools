export class AdapterError extends Error {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  retryable: boolean;

  constructor(
    message: string,
    opts: { status?: number; body?: unknown; headers?: Record<string, string>; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'AdapterError';
    this.status = opts.status;
    this.body = opts.body;
    this.headers = opts.headers;
    this.retryable = opts.retryable ?? false;
  }
}

export class ToolError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}
