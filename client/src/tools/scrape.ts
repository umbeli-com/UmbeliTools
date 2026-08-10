import { UmbeliToolsCore } from '../client.js';

export interface ScrapeMarkdownInput {
  url: string;
  timeoutMs?: number;
}

export interface ScrapeHtmlInput {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
}

export interface ScrapeMarkdownResult {
  url: string;
  via: 'jina.ai';
  markdown: string;
}

export interface ScrapeHtmlResult {
  url: string;
  html: string;
  [key: string]: unknown;
}

export class ScrapeTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Fetch any URL as clean markdown via r.jina.ai. */
  fetchMarkdown(input: ScrapeMarkdownInput) {
    return this.core.request<ScrapeMarkdownResult>('scrape', 'fetch-markdown', input);
  }

  /** Fetch raw HTML directly. */
  fetchHtml(input: ScrapeHtmlInput) {
    return this.core.request<ScrapeHtmlResult>('scrape', 'fetch-html', input);
  }
}
