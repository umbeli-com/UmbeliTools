/**
 * Page fetching. Every outbound request is SSRF-guarded (scheme + resolved
 * address + each redirect hop) — see ssrf.guard.ts / safe-fetch.adapter.ts.
 */
import { BaseAdapter } from '../../lib/baseAdapter';
import { SafeFetchAdapter, DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES } from './safe-fetch.adapter';
import { assertSafeUrl, normalizeUrl } from './ssrf.guard';
import { htmlToText, normalizeText } from './html-text';

const JINA_PREFIX = 'https://r.jina.ai/http://';
const MARKDOWN_MARKER = 'Markdown Content:';
/** Scrapium's rule: anything shorter than this is a bot-wall / empty shell. */
const MIN_MARKDOWN_CHARS = 40;

export { DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES };

function toJinaUrl(url: string): string {
  const target = normalizeUrl(url).replace(/^https?:\/\//i, '');
  return `${JINA_PREFIX}${target}`;
}

function stripJinaEnvelope(payload: string): string {
  const markerIndex = payload.indexOf(MARKDOWN_MARKER);
  if (markerIndex === -1) return payload;
  return payload.slice(markerIndex + MARKDOWN_MARKER.length).trim();
}

export interface FetchOptions {
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface ScrapeAttempt {
  via: 'jina.ai' | 'direct';
  target: string;
  ok: boolean;
  error?: string;
}

export interface ScrapeMarkdownResult {
  url: string;
  via: 'jina.ai' | 'direct';
  markdown: string;
  length: number;
  finalUrl?: string;
  attempts: ScrapeAttempt[];
}

export interface ScrapeHtmlResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  html: string;
  redirects: string[];
  resolvedAddresses: string[];
  truncated: boolean;
  bytes: number;
}

/** Raw HTML, SSRF-guarded, size-capped, redirects re-checked hop by hop. */
export async function scrapeHtml(url: string, opts: FetchOptions = {}): Promise<ScrapeHtmlResult> {
  const fetcher = new SafeFetchAdapter({
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes,
    maxRedirects: opts.maxRedirects,
  });
  const res = await fetcher.fetchText(url, { userAgent: opts.userAgent });

  return {
    url: normalizeUrl(url),
    finalUrl: res.finalUrl,
    status: res.status,
    contentType: res.contentType,
    html: res.body,
    redirects: res.redirects,
    resolvedAddresses: res.resolvedAddresses,
    truncated: res.truncated,
    bytes: res.bytes,
  };
}

/**
 * Two-attempt policy (Scrapium's): r.jina.ai first — it renders and cleans —
 * then a direct guarded fetch converted to text. A payload whose normalised
 * length is <= 40 chars counts as a failure ("too short"), not as a result.
 */
export async function scrapeMarkdown(url: string, opts: FetchOptions = {}): Promise<ScrapeMarkdownResult> {
  const safe = await assertSafeUrl(url); // the caller's target must be public even via jina
  const target = safe.url.toString();
  const attempts: ScrapeAttempt[] = [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // --- attempt 1: jina.ai reader (external, fixed host → BaseAdapter retries) ---
  const jinaUrl = toJinaUrl(target);
  try {
    const jina = new BaseAdapter({
      timeout: timeoutMs,
      retryConfig: { maxRetries: 2 },
      defaultHeaders: {
        'user-agent': opts.userAgent || DEFAULT_USER_AGENT,
        accept: 'text/plain, text/markdown, */*',
        'cache-control': 'no-cache',
      },
    });
    const { data } = await jina.get(jinaUrl);
    const payload = typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data);
    const markdown = stripJinaEnvelope(payload);

    if (normalizeText(markdown).length > MIN_MARKDOWN_CHARS) {
      attempts.push({ via: 'jina.ai', target: jinaUrl, ok: true });
      return { url: target, via: 'jina.ai', markdown, length: markdown.length, attempts };
    }
    attempts.push({ via: 'jina.ai', target: jinaUrl, ok: false, error: 'payload too short' });
  } catch (err: any) {
    attempts.push({ via: 'jina.ai', target: jinaUrl, ok: false, error: err?.message || String(err) });
  }

  // --- attempt 2: direct guarded fetch, converted to text ---
  try {
    const direct = await scrapeHtml(target, opts);
    const looksHtml = /html|xml/i.test(direct.contentType || '') || /<\/?[a-z][\s\S]*>/i.test(direct.html.slice(0, 2000));
    const text = looksHtml ? htmlToText(direct.html) : direct.html;

    if (normalizeText(text).length > MIN_MARKDOWN_CHARS) {
      attempts.push({ via: 'direct', target: direct.finalUrl, ok: true });
      return {
        url: target,
        via: 'direct',
        markdown: text,
        length: text.length,
        finalUrl: direct.finalUrl,
        attempts,
      };
    }
    attempts.push({ via: 'direct', target: direct.finalUrl, ok: false, error: 'payload too short' });
  } catch (err: any) {
    attempts.push({ via: 'direct', target, ok: false, error: err?.message || String(err) });
  }

  const lastError = attempts[attempts.length - 1]?.error || 'unknown error';
  const failure = new Error(`Could not read ${target} (${lastError})`);
  (failure as any).attempts = attempts;
  throw failure;
}
