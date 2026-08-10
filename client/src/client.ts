import {
  UmbeliToolsClientOptions,
  UmbeliToolsError,
  ToolMeta,
  ToolResponse,
} from './types.js';

interface ServerResponse {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  meta?: ToolMeta;
}

export class UmbeliToolsCore {
  private readonly url: string;
  private readonly serviceKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs?: number;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: UmbeliToolsClientOptions) {
    if (!opts.url) throw new Error('UmbeliTools: `url` is required');
    if (!opts.serviceKey) throw new Error('UmbeliTools: `serviceKey` is required');
    const fetchFn = opts.fetch ?? globalThis.fetch;
    if (!fetchFn) throw new Error('UmbeliTools: no `fetch` available (provide one via options on environments without global fetch)');

    this.url = opts.url.replace(/\/+$/, '');
    this.serviceKey = opts.serviceKey;
    this.fetchImpl = fetchFn.bind(globalThis);
    this.timeoutMs = opts.timeoutMs;
    this.extraHeaders = opts.headers ?? {};
  }

  /** Low-level call that returns the full `{ data, meta }` envelope. */
  async call<TData = unknown>(tool: string, action: string, body: unknown): Promise<ToolResponse<TData>> {
    const controller = new AbortController();
    const timer = this.timeoutMs ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}/api/tools/${tool}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-key': this.serviceKey,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
    } catch (err) {
      throw new UmbeliToolsError(
        err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    const parsed = (await res.json().catch(() => null)) as ServerResponse | null;

    if (!res.ok || !parsed || parsed.ok === false) {
      const code = parsed?.error?.code ?? 'HTTP_ERROR';
      const message = parsed?.error?.message ?? `HTTP ${res.status} ${res.statusText}`.trim();
      throw new UmbeliToolsError(code, message, res.status, parsed?.error?.details, parsed?.meta);
    }

    return { data: parsed.data as TData, meta: parsed.meta };
  }

  /** Convenience: returns just `data`, throws on error. */
  async request<TData = unknown>(tool: string, action: string, body: unknown): Promise<TData> {
    const { data } = await this.call<TData>(tool, action, body);
    return data;
  }
}
