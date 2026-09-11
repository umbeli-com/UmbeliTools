/**
 * Redirect-aware, SSRF-guarded HTTP GET.
 *
 * BaseAdapter cannot express `redirect: 'manual'` (it builds its own RequestInit
 * and swallows the Location header on non-2xx), so this subclass drives the
 * redirect loop itself while reusing BaseAdapter's timeout, retry budget,
 * backoff-with-jitter shape and AdapterError contract. Every hop — the original
 * URL and each Location — is re-checked with assertSafeUrl.
 */
import { setTimeout as wait } from 'timers/promises';
import { BaseAdapter } from '../../lib/baseAdapter';
import { AdapterError } from '../../lib/errors';
import { assertSafeUrl } from './ssrf.guard';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const DEFAULT_USER_AGENT = 'UmbeliToolsBot/1.0 (+https://api.tools.umbeli.com)';
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 2_000_000;
const HARD_MAX_BYTES = 10_000_000;
const DEFAULT_MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  userAgent?: string;
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  /** URL actually fetched after redirects. */
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  /** Every hop taken, in order (empty when there was no redirect). */
  redirects: string[];
  /** Addresses the final host resolved to at guard time. */
  resolvedAddresses: string[];
  /** True when the body hit maxBytes and was cut. */
  truncated: boolean;
  bytes: number;
}

export class SafeFetchAdapter extends BaseAdapter {
  private readonly maxRedirects: number;
  private readonly maxBytes: number;

  constructor(opts: { timeoutMs?: number; maxRedirects?: number; maxBytes?: number } = {}) {
    super({
      timeout: Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 120_000),
      retryConfig: { maxRetries: 1 },
    });
    this.maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxBytes = Math.min(opts.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  }

  /** GET `rawUrl`, guarding the target and every redirect hop. */
  async fetchText(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    const headers: Record<string, string> = {
      'user-agent': opts.userAgent || DEFAULT_USER_AGENT,
      accept: opts.accept || 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'accept-language': 'en,fr;q=0.9',
      'cache-control': 'no-cache',
      ...(opts.headers || {}),
    };

    const redirects: string[] = [];
    let current = rawUrl;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const safe = await assertSafeUrl(current);
      const target = safe.url.toString();
      const res = await this.fetchOnce(target, headers);

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get('location');
        if (!location) {
          throw new AdapterError(`HTTP ${res.status} for ${target} without a Location header`, {
            status: res.status,
            retryable: false,
          });
        }
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          throw new AdapterError(`HTTP ${res.status} for ${target} with an unparseable Location: ${location}`, {
            status: res.status,
            retryable: false,
          });
        }
        redirects.push(next);
        current = next; // re-guarded at the top of the next iteration
        continue;
      }

      if (!res.ok) {
        throw new AdapterError(`HTTP ${res.status} fetching ${target}`, {
          status: res.status,
          retryable: false,
        });
      }

      const { text, bytes, truncated } = await this.readCapped(res);
      return {
        finalUrl: target,
        status: res.status,
        contentType: res.headers.get('content-type'),
        body: text,
        redirects,
        resolvedAddresses: safe.addresses,
        truncated,
        bytes,
      };
    }

    throw new AdapterError(`Too many redirects (> ${this.maxRedirects}) starting at ${rawUrl}`, { retryable: false });
  }

  private async fetchOnce(url: string, headers: Record<string, string>): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (err: any) {
        if (attempt < this.retryConfig.maxRetries) {
          await wait(this.backoffDelay(attempt++));
          continue;
        }
        throw new AdapterError(`Network error fetching ${url}: ${err?.message || String(err)}`, { retryable: false });
      }

      if (this.retryConfig.retryableStatuses.includes(res.status) && attempt < this.retryConfig.maxRetries) {
        await wait(this.backoffDelay(attempt++));
        continue;
      }
      return res;
    }
  }

  /** Same exponential-backoff-with-jitter curve BaseAdapter uses internally. */
  private backoffDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * delay;
    return Math.min(delay + jitter, this.retryConfig.maxDelayMs);
  }

  /** Streams the body so a hostile/huge page cannot exhaust memory. */
  private async readCapped(res: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
    const body: any = res.body;
    if (!body || typeof body.getReader !== 'function') {
      const text = await res.text();
      const buf = Buffer.from(text, 'utf8');
      if (buf.length > this.maxBytes) {
        return { text: buf.subarray(0, this.maxBytes).toString('utf8'), bytes: this.maxBytes, truncated: true };
      }
      return { text, bytes: buf.length, truncated: false };
    }

    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value as Uint8Array);
      if (total + chunk.length > this.maxBytes) {
        chunks.push(chunk.subarray(0, this.maxBytes - total));
        total = this.maxBytes;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }

    return { text: Buffer.concat(chunks).toString('utf8'), bytes: total, truncated };
  }
}
