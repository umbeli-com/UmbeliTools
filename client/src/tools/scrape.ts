import { UmbeliToolsCore } from '../client.js';

export interface ScrapeMarkdownInput {
  /** http(s) URL. Private/loopback targets are refused server-side. */
  url: string;
  userAgent?: string;
  timeoutMs?: number;
  /** Body cap for the direct fallback (default 2 MB). */
  maxBytes?: number;
}

export interface ScrapeHtmlInput {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface ScrapeExtractTextInput {
  /** Markup to convert (mutually exclusive with `url`). */
  html?: string;
  /** Fetch this URL first, then convert. */
  url?: string;
  /** Keep paragraph line breaks (default true); false collapses to one line. */
  preserveLineBreaks?: boolean;
  includeLinks?: boolean;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ScrapeRenderHtmlInput {
  /** Page to render (mutually exclusive with `html`). */
  url?: string;
  /** Single-file bundle to render as-is. */
  html?: string;
  /** Render even when the static HTML already carries enough content. */
  force?: boolean;
  /** Static-text threshold under which a page counts as client-rendered (default 500). */
  minTextLength?: number;
  /** Strip `<script>` / loader shells from the snapshot (default true). */
  stripScripts?: boolean;
  includeText?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  waitMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
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
  /** Present only when the direct fallback answered. */
  finalUrl?: string;
  attempts: ScrapeAttempt[];
}

export interface ScrapeHtmlResult {
  url: string;
  /** URL actually fetched after redirects. */
  finalUrl: string;
  status: number;
  contentType: string | null;
  html: string;
  redirects: string[];
  /** Addresses the final host resolved to when the SSRF guard ran. */
  resolvedAddresses: string[];
  /** True when the body hit `maxBytes` and was cut. */
  truncated: boolean;
  bytes: number;
}

export interface ScrapeExtractTextResult {
  source: 'html' | 'url';
  url: string | null;
  status: number | null;
  title: string | null;
  description: string | null;
  text: string;
  textLength: number;
  /** Length after full whitespace normalisation — use it for "is this empty?" checks. */
  normalizedLength: number;
  truncated: boolean;
  /** Only when `includeLinks: true`. */
  links?: string[];
}

export interface CsrDetection {
  likelyClientRendered: boolean;
  reason: string;
  staticTextLength: number;
  inlineScriptChars: number;
  externalScripts: number;
  spaShell: boolean;
}

export interface ScrapeRenderHtmlResult {
  /** false when the static HTML was already good enough (no browser was launched). */
  rendered: boolean;
  reason: string;
  detection: CsrDetection;
  url: string | null;
  finalUrl: string | null;
  title: string | null;
  html: string;
  /** Only when `includeText: true`. */
  text?: string;
  /** Subresource requests the SSRF guard aborted during the render. */
  blockedRequests: number;
}

export class ScrapeTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /**
   * Fetch any URL as clean markdown. Tries r.jina.ai first, then a direct
   * guarded fetch converted to text; a payload under ~40 normalised characters
   * is treated as a failure, not as a result.
   *
   * Throws `UmbeliToolsError` with code `BLOCKED_URL` when the target is not a
   * public http(s) address.
   */
  fetchMarkdown(input: ScrapeMarkdownInput) {
    return this.core.request<ScrapeMarkdownResult>('scrape', 'fetch-markdown', input);
  }

  /** Fetch raw HTML directly (SSRF-guarded, size-capped, redirects re-checked). */
  fetchHtml(input: ScrapeHtmlInput) {
    return this.core.request<ScrapeHtmlResult>('scrape', 'fetch-html', input);
  }

  /**
   * HTML → plain text: strips script/style/noscript, decodes entities and
   * collapses whitespace. Pass `html`, or a `url` to fetch first.
   */
  extractText(input: ScrapeExtractTextInput) {
    return this.core.request<ScrapeExtractTextResult>('scrape', 'extract-text', input);
  }

  /**
   * Headless-Chromium fallback for client-rendered pages. Fetches statically
   * first and only renders when the page looks like an SPA shell (or
   * `force: true`); returns a script-free snapshot.
   *
   * Throws `UmbeliToolsError` with code `CONFIG_ERROR` when the service image
   * has no Chromium available — treat that as "fall back to fetch-html".
   */
  renderHtml(input: ScrapeRenderHtmlInput) {
    return this.core.request<ScrapeRenderHtmlResult>('scrape', 'render-html', input);
  }
}
