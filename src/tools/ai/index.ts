import { Router } from 'express';
import type { Response } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { AdapterError, ToolError } from '../../lib/errors';
import { anthropicComplete, anthropicGenerateJSON } from './anthropic.adapter';
import { openaiComplete, openaiGenerateJSON } from './openai.adapter';
import { geminiComplete, geminiGenerateJSON } from './gemini.adapter';
import { openaiWebResearch } from './openai-responses.adapter';
import { openaiEmbed, normalizeEmbeddingText, EMBEDDINGS_DEFAULT_MODEL } from './embeddings.adapter';
import { validateMessages } from './content';
import {
  ProviderChainError,
  resolveProviderChain,
  runWithFailover,
  unsupportedProviders,
} from './failover';
import type { AIProviderCredential } from './types';
import type {
  AICompleteInput,
  AICompletionResult,
  AIJSONResult,
  AIEmbedInput,
  AIGenerateJSONInput,
  AIMessage,
  AIWebResearchInput,
} from './types';

const router = Router();

/**
 * Last-resort recovery only. Structured output now comes from provider-native
 * JSON modes (OpenAI `response_format`, Anthropic forced tool-use, Gemini
 * `responseMimeType`); this runs solely when a provider answered in prose
 * anyway, so a caller never gets `null` where the old extraction would have
 * found something.
 */
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

/** A top-level `model` belongs to the primary provider — a fallback provider would 404 on it. */
function modelFor(credential: AIProviderCredential, index: number, requested?: string) {
  return credential.model || (index === 0 ? requested : undefined);
}

function runComplete(
  credential: AIProviderCredential,
  index: number,
  input: AICompleteInput,
): Promise<AICompletionResult> {
  const opts = {
    model: modelFor(credential, index, input.model),
    maxTokens: input.maxTokens,
    systemPrompt: input.systemPrompt,
    temperature: input.temperature,
  };

  switch (credential.provider) {
    case 'anthropic':
      return anthropicComplete(credential.apiKey, input.messages, opts);
    case 'openai':
      return openaiComplete(credential.apiKey, input.messages, opts);
    case 'gemini':
      return geminiComplete(credential.apiKey, input.messages, opts);
    default:
      throw new ToolError('INVALID_FIELD', `Unknown AI provider: ${credential.provider}`);
  }
}

function runGenerateJSON(
  credential: AIProviderCredential,
  index: number,
  messages: AIMessage[],
  input: AIGenerateJSONInput,
): Promise<AIJSONResult> {
  const opts = {
    model: modelFor(credential, index, input.model),
    maxTokens: input.maxTokens,
    systemPrompt: input.systemPrompt,
    temperature: input.temperature,
    schema: input.schema,
  };

  switch (credential.provider) {
    case 'anthropic':
      return anthropicGenerateJSON(credential.apiKey, messages, opts);
    case 'openai':
      return openaiGenerateJSON(credential.apiKey, messages, opts);
    case 'gemini':
      return geminiGenerateJSON(credential.apiKey, messages, opts);
    default:
      throw new ToolError('INVALID_FIELD', `Unknown AI provider: ${credential.provider}`);
  }
}

/** Maps validation errors to 400 and upstream failures to 502, keeping the failover trail. */
function fail(res: Response, start: number, err: unknown, provider?: string) {
  const durationMs = Date.now() - start;

  if (err instanceof ToolError) {
    return sendError(res, 400, err.code, err.message, err.details, { durationMs, provider });
  }

  if (err instanceof ProviderChainError) {
    if (err.lastError instanceof ToolError) {
      return sendError(res, 400, err.lastError.code, err.lastError.message, undefined, {
        durationMs,
        provider: err.lastProvider,
      });
    }
    return sendError(res, 502, 'PROVIDER_ERROR', err.message, { attempts: err.attempts }, {
      durationMs,
      provider: err.lastProvider,
      providerStatus: err.status,
      attempts: err.attempts,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  const details = err instanceof AdapterError ? { status: err.status, body: err.body } : undefined;
  return sendError(res, 502, 'PROVIDER_ERROR', message, details, {
    durationMs,
    provider,
    ...(err instanceof AdapterError && err.status ? { providerStatus: err.status } : {}),
  });
}

router.post('/complete', async (req, res) => {
  const start = Date.now();
  const input = req.body as AICompleteInput;

  const chain = resolveProviderChain(input.credentials);
  if (!chain.length) {
    return sendError(
      res,
      400,
      'MISSING_CREDENTIALS',
      'credentials.provider + credentials.apiKey (or credentials.providers[] with at least one configured apiKey) are required',
    );
  }
  const unknown = unsupportedProviders(chain);
  if (unknown.length) {
    return sendError(res, 400, 'INVALID_FIELD', `Unknown AI provider(s): ${unknown.join(', ')}`);
  }

  try {
    validateMessages(input.messages);
  } catch (err) {
    return fail(res, start, err, chain[0].provider);
  }

  try {
    const outcome = await runWithFailover(
      chain,
      (credential, index) => runComplete(credential, index, input),
      { failoverOnAuthErrors: input.failoverOnAuthErrors },
    );

    sendSuccess(res, outcome.result, {
      durationMs: Date.now() - start,
      provider: outcome.provider,
      ...(outcome.attempts.length ? { attempts: outcome.attempts, failedOver: true } : {}),
    });
  } catch (err) {
    fail(res, start, err, chain[0].provider);
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

  const chain = resolveProviderChain(input.credentials);
  if (!chain.length) {
    return sendError(
      res,
      400,
      'MISSING_CREDENTIALS',
      'credentials.provider + credentials.apiKey (or credentials.providers[] with at least one configured apiKey) are required',
    );
  }
  const unknown = unsupportedProviders(chain);
  if (unknown.length) {
    return sendError(res, 400, 'INVALID_FIELD', `Unknown AI provider(s): ${unknown.join(', ')}`);
  }

  const messages: AIMessage[] = input.messages?.length
    ? input.messages
    : input.userPrompt
      ? [{ role: 'user', content: input.userPrompt }]
      : [];

  if (!messages.length) {
    return sendError(res, 400, 'MISSING_FIELDS', 'userPrompt (or messages) is required');
  }
  if (input.schema !== undefined && (typeof input.schema !== 'object' || input.schema === null || Array.isArray(input.schema))) {
    return sendError(res, 400, 'INVALID_FIELD', 'schema must be a JSON Schema object');
  }

  try {
    validateMessages(messages);
  } catch (err) {
    return fail(res, start, err, chain[0].provider);
  }

  try {
    const outcome = await runWithFailover(
      chain,
      (credential, index) => runGenerateJSON(credential, index, messages, input),
      { failoverOnAuthErrors: input.failoverOnAuthErrors },
    );

    const result = outcome.result;
    const raw = result.content || '';
    let data = result.data;
    let mode: string = result.mode;

    if (data === undefined) {
      data = parseJSON(raw);
      mode = 'text_fallback';
    }

    sendSuccess(
      res,
      {
        data: data ?? null,
        raw,
        usage: (result as { usage?: unknown }).usage,
        provider: outcome.provider,
        mode,
      },
      {
        durationMs: Date.now() - start,
        provider: outcome.provider,
        mode,
        ...(outcome.attempts.length ? { attempts: outcome.attempts, failedOver: true } : {}),
      },
    );
  } catch (err) {
    fail(res, start, err, chain[0].provider);
  }
});

router.post('/embed', async (req, res) => {
  const start = Date.now();
  const input = req.body as AIEmbedInput;

  if (!input.credentials?.apiKey) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey (OpenAI) is required');
  }
  if (input.credentials.provider && input.credentials.provider !== 'openai') {
    return sendError(res, 400, 'INVALID_FIELD', 'embed currently supports credentials.provider "openai" only');
  }

  const raw = input.input ?? input.texts ?? input.text;
  if (raw === undefined || raw === null) {
    return sendError(res, 400, 'MISSING_FIELDS', 'input is required (a string or an array of strings)');
  }

  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) {
    return sendError(res, 400, 'MISSING_FIELDS', 'input must contain at least one string');
  }
  if (list.some((value) => typeof value !== 'string')) {
    return sendError(res, 400, 'INVALID_FIELD', 'input must be a string or an array of strings');
  }
  if (list.every((value) => normalizeEmbeddingText(value) === '')) {
    return sendError(res, 400, 'MISSING_FIELDS', 'input must contain at least one non-empty string');
  }
  if (input.dimensions !== undefined && (!Number.isInteger(input.dimensions) || input.dimensions < 1)) {
    return sendError(res, 400, 'INVALID_FIELD', 'dimensions must be a positive integer');
  }
  if (input.maxChars !== undefined && (!Number.isInteger(input.maxChars) || input.maxChars < 1)) {
    return sendError(res, 400, 'INVALID_FIELD', 'maxChars must be a positive integer');
  }

  try {
    const result = await openaiEmbed(input.credentials.apiKey, Array.isArray(raw) ? list : list[0], {
      model: input.model,
      dimensions: input.dimensions,
      maxChars: input.maxChars,
      user: input.user,
    });

    sendSuccess(res, result, {
      durationMs: Date.now() - start,
      provider: 'openai',
      model: result.model,
      count: result.count,
    });
  } catch (err) {
    fail(res, start, err, 'openai');
  }
});

const credentialsSchema = {
  type: 'object',
  description:
    'Either a single provider (provider + apiKey) or an ordered providers[] failover chain. Entries with an empty apiKey are skipped.',
  properties: {
    provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] },
    apiKey: { type: 'string' },
    providers: {
      type: 'array',
      description: 'Ordered failover chain, tried first to last. meta.provider says which one answered.',
      items: {
        type: 'object',
        required: ['provider', 'apiKey'],
        properties: {
          provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] },
          apiKey: { type: 'string' },
          model: { type: 'string', description: 'Model for this provider (IDs are not portable across providers)' },
        },
      },
    },
  },
};

const messagesSchema = {
  type: 'array',
  description: 'Chat messages. `content` is a string, or an array of content blocks for multimodal input.',
  items: {
    type: 'object',
    required: ['role', 'content'],
    properties: {
      role: { type: 'string', enum: ['user', 'assistant', 'system'] },
      content: {
        oneOf: [
          { type: 'string' },
          {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['text', 'image'] },
                text: { type: 'string', description: 'For type "text"' },
                image: {
                  type: 'string',
                  description:
                    'For type "image": a data URL ("data:image/png;base64,..."), bare base64 (then set mediaType), or an https:// URL. Mapped to Anthropic image blocks / OpenAI image_url / Gemini inlineData. Gemini rejects https URLs.',
                },
                mediaType: { type: 'string', description: 'e.g. "image/png" — required for bare base64 that cannot be sniffed' },
              },
            },
          },
        ],
      },
    },
  },
};

export const aiTool: ToolDefinition = {
  name: 'ai',
  description:
    'AI text completion (text + images), provider-native structured JSON, web research and OpenAI embeddings, via Anthropic, OpenAI or Gemini with optional ordered failover',
  actions: [
    {
      action: 'complete',
      description:
        'Generate a completion from any supported provider. Accepts text and image content blocks, and an ordered credentials.providers[] failover chain (transport / 408 / 429 / 5xx only — never a 400). meta.provider reports who answered.',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'messages'],
        properties: {
          credentials: credentialsSchema,
          messages: messagesSchema,
          systemPrompt: { type: 'string' },
          model: { type: 'string', description: 'Applies to the first provider in the chain only' },
          maxTokens: { type: 'number' },
          temperature: { type: 'number', description: 'Ignored on Anthropic models that reject sampling parameters (Claude 4.6+/5 families, incl. the default claude-sonnet-5) — steer those with the prompt instead' },
          failoverOnAuthErrors: {
            type: 'boolean',
            default: false,
            description: 'Also fail over on 401/403 (a bad key on one provider)',
          },
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
      description:
        'Structured JSON via provider-native JSON mode (OpenAI response_format json_object, Anthropic forced tool-use, Gemini responseMimeType). Returns { data, raw, usage, provider, mode }.',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credentialsSchema,
          systemPrompt: { type: 'string' },
          userPrompt: { type: 'string', description: 'Shorthand for a single user message; required unless messages is given' },
          messages: messagesSchema,
          schema: {
            type: 'object',
            description:
              'JSON Schema for the payload. Anthropic uses it as the forced tool input_schema; OpenAI/Gemini receive it as an instruction.',
          },
          model: { type: 'string' },
          maxTokens: { type: 'number' },
          temperature: { type: 'number', description: 'Ignored on Anthropic models that reject sampling parameters (Claude 4.6+/5 families, incl. the default claude-sonnet-5) — steer those with the prompt instead' },
          failoverOnAuthErrors: { type: 'boolean', default: false },
        },
      },
    },
    {
      action: 'embed',
      description:
        'Vector embeddings via OpenAI /v1/embeddings. Whitespace-normalises and truncates each input, batches transparently, and returns index-aligned vectors plus usage.',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'input'],
        properties: {
          credentials: {
            type: 'object',
            required: ['apiKey'],
            properties: {
              apiKey: { type: 'string', description: 'OpenAI API key' },
              provider: { type: 'string', enum: ['openai'], default: 'openai' },
            },
          },
          input: {
            description: 'A string or an array of strings (aliases: text, texts). Empty entries return a null vector.',
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
          model: { type: 'string', default: EMBEDDINGS_DEFAULT_MODEL },
          dimensions: { type: 'number', description: 'Output dimensions (text-embedding-3-* only)' },
          maxChars: { type: 'number', default: 6000, description: 'Per-input character budget after whitespace normalisation' },
          user: { type: 'string', description: 'Opaque end-user id forwarded to OpenAI' },
        },
      },
    },
  ],
  router,
};
