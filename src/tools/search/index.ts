import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { googleSearch } from './serper.adapter';
import type { SearchGoogleInput } from './types';

const router = Router();

router.post('/google', async (req, res) => {
  const start = Date.now();
  const input = req.body as SearchGoogleInput;

  if (!input.credentials?.apiKey) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey is required');
  if (!input.query) return sendError(res, 400, 'MISSING_FIELDS', 'query is required');

  try {
    const result = await googleSearch(input.credentials.apiKey, input.query, {
      country: input.country,
      language: input.language,
      numResults: input.numResults,
      page: input.page,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'serper' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'serper' });
  }
});

export const searchTool: ToolDefinition = {
  name: 'search',
  description: 'Web search via Serper (Google search results as JSON)',
  actions: [
    {
      action: 'google',
      description: 'Run a Google search via the Serper API and return structured results',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'query'],
        properties: {
          credentials: {
            type: 'object',
            required: ['apiKey'],
            properties: { apiKey: { type: 'string' } },
          },
          query: { type: 'string' },
          country: { type: 'string', description: 'Country code (e.g. "ca", "us")' },
          language: { type: 'string', description: 'Language code (e.g. "en", "fr")' },
          numResults: { type: 'number', default: 10 },
          page: { type: 'number', default: 1 },
        },
      },
    },
  ],
  router,
};
