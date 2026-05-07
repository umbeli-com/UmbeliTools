import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { anthropicComplete } from './anthropic.adapter';
import { openaiComplete } from './openai.adapter';
import { geminiComplete } from './gemini.adapter';
import { openaiWebResearch } from './openai-responses.adapter';
import type { AICompleteInput, AIGenerateJSONInput, AIWebResearchInput } from './types';

const router = Router();

function parseJSON(text: string): unknown | null {
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try { return JSON.parse(objectMatch[0]); } catch { /* fall through */ }
  }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

async function runComplete(input: AICompleteInput) {
  const { provider, apiKey } = input.credentials;
  const opts = { model: input.model, maxTokens: input.maxTokens, systemPrompt: input.systemPrompt, temperature: input.temperature };

  switch (provider) {
    case 'anthropic':
      return anthropicComplete(apiKey, input.messages, opts);
    case 'openai':
      return openaiComplete(apiKey, input.messages, opts);
    case 'gemini':
      return geminiComplete(apiKey, input.messages, opts);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

router.post('/complete', async (req, res) => {
  const start = Date.now();
  const input = req.body as AICompleteInput;

  if (!input.credentials?.provider || !input.credentials?.apiKey) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.provider and credentials.apiKey are required');
  }
  if (!input.messages?.length) {
    return sendError(res, 400, 'MISSING_FIELDS', 'messages array is required');
  }

  try {
    const result = await runComplete(input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: input.credentials.provider });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: input.credentials.provider,
    });
  }
});

router.post('/web-research', async (req, res) => {
  const start = Date.now();
  const input = req.body as AIWebResearchInput;

  if (!input.credentials?.apiKey) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey is required');
  if (!input.prompt) return sendError(res, 400, 'MISSING_FIELDS', 'prompt is required');

  try {
    const result = await openaiWebResearch(input.credentials.apiKey, input.prompt, input.model);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'openai', tool: 'web_search' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'openai' });
  }
});

router.post('/generate-json', async (req, res) => {
  const start = Date.now();
  const input = req.body as AIGenerateJSONInput;

  if (!input.credentials?.provider || !input.credentials?.apiKey) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.provider and credentials.apiKey are required');
  }
  if (!input.userPrompt) {
    return sendError(res, 400, 'MISSING_FIELDS', 'userPrompt is required');
  }

  try {
    const messages = [{ role: 'user', content: input.userPrompt }];
    const completeInput: AICompleteInput = {
      credentials: input.credentials,
      messages,
      systemPrompt: input.systemPrompt,
      model: input.model,
      maxTokens: input.maxTokens,
    };
    const result = await runComplete(completeInput);
    const parsed = parseJSON((result as any).content || '');

    sendSuccess(res, { data: parsed, raw: (result as any).content, usage: (result as any).usage }, {
      durationMs: Date.now() - start,
      provider: input.credentials.provider,
    });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: input.credentials.provider,
    });
  }
});

export const aiTool: ToolDefinition = {
  name: 'ai',
  description: 'AI text completion and structured output via Anthropic, OpenAI, or Gemini',
  actions: [
    {
      action: 'complete',
      description: 'Generate a text completion from any supported AI provider',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'messages'],
        properties: {
          credentials: {
            type: 'object',
            required: ['provider', 'apiKey'],
            properties: {
              provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] },
              apiKey: { type: 'string' },
            },
          },
          messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } },
          systemPrompt: { type: 'string' },
          model: { type: 'string' },
          maxTokens: { type: 'number' },
          temperature: { type: 'number' },
        },
      },
    },
    {
      action: 'web-research',
      description: 'Real-time web-grounded AI research via OpenAI Responses API + web_search tool',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'prompt'],
        properties: {
          credentials: {
            type: 'object',
            required: ['apiKey'],
            properties: { apiKey: { type: 'string', description: 'OpenAI API key' } },
          },
          prompt: { type: 'string', description: 'Research prompt' },
          model: { type: 'string', default: 'gpt-4o-mini' },
        },
      },
    },
    {
      action: 'generate-json',
      description: 'Generate structured JSON output from an AI provider',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'userPrompt'],
        properties: {
          credentials: {
            type: 'object',
            required: ['provider', 'apiKey'],
            properties: {
              provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] },
              apiKey: { type: 'string' },
            },
          },
          systemPrompt: { type: 'string' },
          userPrompt: { type: 'string' },
          model: { type: 'string' },
          maxTokens: { type: 'number' },
        },
      },
    },
  ],
  router,
};
