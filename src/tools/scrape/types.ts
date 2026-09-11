export interface ScrapeMarkdownInput {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
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
  /** Markup to convert. Mutually exclusive with `url`. */
  html?: string;
  /** Fetch this URL first (SSRF-guarded), then convert. */
  url?: string;
  /** Keep paragraph line breaks (default true); false → a single line. */
  preserveLineBreaks?: boolean;
  /** Also return the absolute http(s) links found in the markup. */
  includeLinks?: boolean;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ScrapeRenderHtmlInput {
  /** Page to render. Mutually exclusive with `html`. */
  url?: string;
  /** Single-file bundle to render as-is. */
  html?: string;
  /** Render even when the static HTML already has enough content. */
  force?: boolean;
  /** Static-text threshold under which a page is considered CSR (default 500). */
  minTextLength?: number;
  /** Strip <script>/loader shells from the snapshot (default true). */
  stripScripts?: boolean;
  /** Also return the extracted text of the snapshot. */
  includeText?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  waitMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
}
