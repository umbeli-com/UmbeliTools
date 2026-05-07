export interface ScrapeMarkdownInput {
  url: string;
  timeoutMs?: number;
}

export interface ScrapeHtmlInput {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
}
