import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { scrapeMarkdown, scrapeHtml } from './scrape.adapter';
import type { ScrapeMarkdownInput, ScrapeHtmlInput } from './types';

const router = Router();

router.post('/fetch-markdown', async (req, res) => {
  const start = Date.now();
  const input = req.body as ScrapeMarkdownInput;

  if (!input.url) return sendError(res, 400, 'MISSING_FIELDS', 'url is required');

  try {
    const result = await scrapeMarkdown(input.url, input.timeoutMs);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'jina.ai' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'jina.ai' });
  }
});

router.post('/fetch-html', async (req, res) => {
  const start = Date.now();
  const input = req.body as ScrapeHtmlInput;

  if (!input.url) return sendError(res, 400, 'MISSING_FIELDS', 'url is required');

  try {
    const result = await scrapeHtml(input.url, { userAgent: input.userAgent, timeoutMs: input.timeoutMs });
    sendSuccess(res, result, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 502, 'FETCH_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

export const scrapeTool: ToolDefinition = {
  name: 'scrape',
  description: 'Fetch web pages as markdown (via jina.ai) or raw HTML',
  actions: [
    {
      action: 'fetch-markdown',
      description: 'Fetch a URL via jina.ai reader and return clean markdown — ideal for AI agents',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          timeoutMs: { type: 'number', default: 20000 },
        },
      },
    },
    {
      action: 'fetch-html',
      description: 'Fetch a URL directly and return raw HTML',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          userAgent: { type: 'string', default: 'UmbeliToolsBot/1.0' },
          timeoutMs: { type: 'number', default: 20000 },
        },
      },
    },
  ],
  router,
};
