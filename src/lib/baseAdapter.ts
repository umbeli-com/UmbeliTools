import { setTimeout as wait } from 'timers/promises';
import { AdapterError } from './errors';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

interface RequestOpts {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  json?: boolean;
  retries?: number;
  raw?: boolean;
}

export class BaseAdapter {
  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;
  protected retryConfig: RetryConfig;
  protected timeout: number;

  constructor(opts: {
    baseUrl?: string;
    defaultHeaders?: Record<string, string>;
    retryConfig?: Partial<RetryConfig>;
    timeout?: number;
  } = {}) {
    this.baseUrl = opts.baseUrl || '';
    this.defaultHeaders = opts.defaultHeaders || {};
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...opts.retryConfig };
    this.timeout = opts.timeout || 30000;
  }

  async request(method: string, path: string, opts: RequestOpts = {}) {
    const {
      query = {},
      body,
      headers = {},
      json = true,
      retries = this.retryConfig.maxRetries,
      raw = false,
    } = opts;

    const url = this.buildUrl(path, query);
    const requestHeaders: Record<string, string> = { ...this.defaultHeaders, ...headers };

    const init: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined) {
      if (json && typeof body === 'object' && !(body instanceof URLSearchParams)) {
        requestHeaders['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      } else if (body instanceof URLSearchParams) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = body.toString();
      } else {
        init.body = body as string;
      }
    }

    return this.executeWithRetry(url, init, retries, raw);
  }

  private async executeWithRetry(url: string, init: RequestInit, retriesLeft: number, raw: boolean): Promise<any> {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeout) });

      if (!res.ok) {
        const errorBody = await this.parseResponse(res);
        const retryable = this.retryConfig.retryableStatuses.includes(res.status);

        if (retryable && retriesLeft > 0) {
          const delay = this.calculateDelay(this.retryConfig.maxRetries - retriesLeft);
          await wait(delay);
          return this.executeWithRetry(url, init, retriesLeft - 1, raw);
        }

        throw new AdapterError(`${init.method} ${url} failed with status ${res.status}`, {
          status: res.status,
          body: errorBody,
          retryable,
        });
      }

      if (raw) return { response: res, headers: res.headers };

      const data = await this.parseResponse(res);
      return { data, headers: res.headers, status: res.status };
    } catch (err: any) {
      if (err instanceof AdapterError) throw err;

      if (retriesLeft > 0 && this.isNetworkError(err)) {
        const delay = this.calculateDelay(this.retryConfig.maxRetries - retriesLeft);
        await wait(delay);
        return this.executeWithRetry(url, init, retriesLeft - 1, raw);
      }

      throw new AdapterError(`Network error: ${err.message}`, { retryable: false });
    }
  }

  private buildUrl(path: string, query: Record<string, string | number | undefined | null> = {}) {
    const base = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const url = new URL(base);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async parseResponse(res: Response) {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    if (contentType.includes('application/json') && text) {
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }
    return text || null;
  }

  private calculateDelay(attempt: number) {
    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * delay;
    return Math.min(delay + jitter, this.retryConfig.maxDelayMs);
  }

  private isNetworkError(err: any) {
    return (
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ENOTFOUND' ||
      err.message?.includes('fetch failed')
    );
  }

  get(path: string, opts?: RequestOpts) { return this.request('GET', path, opts); }
  post(path: string, opts?: RequestOpts) { return this.request('POST', path, opts); }
  put(path: string, opts?: RequestOpts) { return this.request('PUT', path, opts); }
  delete(path: string, opts?: RequestOpts) { return this.request('DELETE', path, opts); }
  patch(path: string, opts?: RequestOpts) { return this.request('PATCH', path, opts); }
}
