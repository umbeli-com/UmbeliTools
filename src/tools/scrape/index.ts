import { Router } from 'express';
import type { Response } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { AdapterError } from '../../lib/errors';
import { scrapeMarkdown, scrapeHtml } from './scrape.adapter';
import { htmlToText, normalizeText, extractTitle, extractDescription, extractLinks } from './html-text';
import { detectClientRendered, renderToStaticHtml, BrowserUnavailableError } from './render.adapter';
import { assertSafeUrl, BlockedUrlError } from './ssrf.guard';
import type {
  ScrapeMarkdownInput,
  ScrapeHtmlInput,
  ScrapeExtractTextInput,
  ScrapeRenderHtmlInput,
} from './types';

const router = Router();

/**
 * Maps an adapter failure onto the house error contract.
 * `BLOCKED_URL` (400) is the SSRF guard refusing the target — never an upstream fault.
 */
function fail(
  res: Response,
  err: any,
  meta: Record<string, unknown>,
  fetchErrorCode: 'PROVIDER_ERROR' | 'FETCH_ERROR' = 'PROVIDER_ERROR',
) {
  if (err instanceof BlockedUrlError) {
    return sendError(res, 400, 'BLOCKED_URL', err.message, undefined, meta);
  }
  if (err instanceof BrowserUnavailableError) {
    return sendError(res, 503, 'CONFIG_ERROR', err.message, undefined, meta);
  }
  const details = err?.attempts ?? (err instanceof AdapterError ? { status: err.status } : undefined);
  return sendError(res, 502, fetchErrorCode, err?.message || String(err), details, meta);
}

router.post('/fetch-markdown', async (req, res) => {
  const start = Date.now();
  const input = req.body as ScrapeMarkdownInput;

  if (!input?.url) return sendError(res, 400, 'MISSING_FIELDS', 'url is required');

  try {
    const result = await scrapeMarkdown(input.url, {
      userAgent: input.userAgent,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: result.via });
  } catch (err: any) {
    fail(res, err, { durationMs: Date.now() - start, provider: 'jina.ai' });
  }
});

router.post('/fetch-html', async (req, res) => {
  const start = Date.now();
  const input = req.body as ScrapeHtmlInput;

  if (!input?.url) return sendError(res, 400, 'MISSING_FIELDS', 'url is required');

  try {
    const result = await scrapeHtml(input.url, {
      userAgent: input.userAgent,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      maxRedirects: input.maxRedirects,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start });
  } catch (err: any) {
    // Kept as FETCH_ERROR (not PROVIDER_ERROR) for backwards compatibility with
    // callers already matching on this code.
    fail(res, err, { durationMs: Date.now() - start }, 'FETCH_ERROR');
  }
});

router.post('/extract-text', async (req, res) => {
  const start = Date.now();
  const input = req.body as ScrapeExtractTextInput;

  if (!input?.html && !input?.url) {
    return sendError(res, 400, 'MISSING_FIELDS', 'html or url is required');
  }

  try {
    let html = input.html ?? '';
    let sourceUrl: string | null = null;
    let status: number | null = null;
    let truncated = false;

    if (!input.html && input.url) {
      const fetched = await scrapeHtml(input.url, {
        userAgent: input.userAgent,
        timeoutMs: input.timeoutMs,
        maxBytes: input.maxBytes,
      });
      html = fetched.html;
      sourceUrl = fetched.finalUrl;
      status = fetched.status;
      truncated = fetched.truncated;
    }

    const text = htmlToText(html, { preserveLineBreaks: input.preserveLineBreaks });
    sendSuccess(
      res,
      {
        source: input.html ? 'html' : 'url',
        url: sourceUrl,
        status,
        title: extractTitle(html),
        description: extractDescription(html),
        text,
        textLength: text.length,
        normalizedLength: normalizeText(text).length,
        truncated,
        links: input.includeLinks ? extractLinks(html, sourceUrl ?? undefined) : undefined,
      },
      { durationMs: Date.now() - start },
    );
  } catch (err: any) {
    fail(res, err, { durationMs: Date.now() - start }, 'FETCH_ERROR');
  }
});

router.post('/render-html', async (req, res) => {
  const start = Date.now();
  const input = req.body as ScrapeRenderHtmlInput;

  if (!input?.url && !input?.html) {
    return sendError(res, 400, 'MISSING_FIELDS', 'url or html is required');
  }

  try {
    let staticHtml = input.html ?? '';
    let targetUrl: string | null = null;

    if (!input.html && input.url) {
      const safe = await assertSafeUrl(input.url);
      targetUrl = safe.url.toString();
      const fetched = await scrapeHtml(targetUrl, {
        userAgent: input.userAgent,
        timeoutMs: input.timeoutMs,
        maxBytes: input.maxBytes,
      });
      staticHtml = fetched.html;
      targetUrl = fetched.finalUrl;
    }

    const detection = detectClientRendered(staticHtml, { minTextLength: input.minTextLength });

    // Static page with real content → no reason to pay for a browser.
    if (!input.force && !detection.likelyClientRendered) {
      const text = input.includeText ? htmlToText(staticHtml) : undefined;
      return sendSuccess(
        res,
        {
          rendered: false,
          reason: detection.reason,
          detection,
          url: targetUrl,
          finalUrl: targetUrl,
          title: extractTitle(staticHtml),
          html: staticHtml,
          text,
          blockedRequests: 0,
        },
        { durationMs: Date.now() - start, provider: 'static' },
      );
    }

    const rendered = await renderToStaticHtml({
      url: targetUrl ?? undefined,
      html: input.html,
      timeoutMs: input.timeoutMs,
      waitMs: input.waitMs,
      waitUntil: input.waitUntil,
      userAgent: input.userAgent,
      stripScripts: input.stripScripts,
    });

    sendSuccess(
      res,
      {
        rendered: true,
        reason: input.force && !detection.likelyClientRendered ? 'forced' : detection.reason,
        detection,
        url: targetUrl,
        finalUrl: rendered.finalUrl ?? targetUrl,
        title: rendered.title,
        html: rendered.html,
        text: input.includeText ? htmlToText(rendered.html) : undefined,
        blockedRequests: rendered.blockedRequests,
      },
      { durationMs: Date.now() - start, provider: rendered.renderedWith },
    );
  } catch (err: any) {
    fail(res, err, { durationMs: Date.now() - start, provider: 'playwright' });
  }
});

export const scrapeTool: ToolDefinition = {
  name: 'scrape',
  description:
    'Fetch and clean web pages: markdown (jina.ai + direct fallback), raw HTML, plain text, and a headless-Chromium render for client-side apps. Every fetch is SSRF-guarded (http/https only, resolved address checked, redirects re-checked).',
  actions: [
    {
      action: 'fetch-markdown',
      description:
        'Fetch a URL as clean markdown. Two attempts: jina.ai reader, then a direct guarded fetch converted to text; a payload under ~40 normalised chars counts as a failure.',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'http(s) URL; private/loopback hosts are refused' },
          userAgent: { type: 'string', default: 'UmbeliToolsBot/1.0' },
          timeoutMs: { type: 'number', default: 20000 },
          maxBytes: { type: 'number', default: 2000000, description: 'Body cap for the direct fallback' },
        },
      },
    },
    {
      action: 'fetch-html',
      description: 'Fetch a URL directly and return raw HTML (SSRF-guarded, size-capped, redirects re-checked).',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          userAgent: { type: 'string', default: 'UmbeliToolsBot/1.0' },
          timeoutMs: { type: 'number', default: 20000 },
          maxBytes: { type: 'number', default: 2000000 },
          maxRedirects: { type: 'number', default: 5 },
        },
      },
    },
    {
      action: 'extract-text',
      description:
        'HTML → plain text: strips script/style/noscript, decodes entities, collapses whitespace. Pass html, or a url to fetch first. Also returns title and meta description.',
      inputSchema: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'Markup to convert (mutually exclusive with url)' },
          url: { type: 'string', description: 'Fetch this URL first (SSRF-guarded), then convert' },
          preserveLineBreaks: { type: 'boolean', default: true },
          includeLinks: { type: 'boolean', default: false },
          userAgent: { type: 'string', default: 'UmbeliToolsBot/1.0' },
          timeoutMs: { type: 'number', default: 20000 },
          maxBytes: { type: 'number', default: 2000000 },
        },
      },
    },
    {
      action: 'render-html',
      description:
        'Headless-Chromium fallback for client-rendered pages. Fetches statically first and only renders when the page looks like an SPA shell (or force:true); returns a script-free snapshot. Answers 503 CONFIG_ERROR when Chromium is not installed in the image.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Page to render (mutually exclusive with html)' },
          html: { type: 'string', description: 'Single-file bundle to render as-is' },
          force: { type: 'boolean', default: false, description: 'Render even when the static HTML is sufficient' },
          minTextLength: { type: 'number', default: 500, description: 'Static-text threshold for CSR detection' },
          stripScripts: { type: 'boolean', default: true },
          includeText: { type: 'boolean', default: false },
          waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], default: 'networkidle' },
          waitMs: { type: 'number', default: 2500, description: 'Extra settle time after load' },
          userAgent: { type: 'string' },
          timeoutMs: { type: 'number', default: 30000 },
          maxBytes: { type: 'number', default: 2000000 },
        },
      },
    },
  ],
  router,
};
