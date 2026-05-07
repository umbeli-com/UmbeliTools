import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { anonymize, deanonymize, anonymizeMany } from './anonymizer';
import type { AnonymizerConfig, MappingEntry, Rule } from './types';
import { DEFAULT_CONFIG } from './types';
import { anthropicComplete } from '../ai/anthropic.adapter';
import { openaiComplete } from '../ai/openai.adapter';
import { geminiComplete } from '../ai/gemini.adapter';

const router = Router();

interface AnonymizeInput {
  text: string;
  rules?: Rule[];
  config?: Partial<AnonymizerConfig>;
}

interface DeanonymizeInput {
  text: string;
  mapping: MappingEntry[];
}

interface AiCompleteInput {
  credentials: {
    provider: 'anthropic' | 'openai' | 'gemini';
    apiKey: string;
  };
  messages: { role: string; content: string }[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  rules?: Rule[];
  config?: Partial<AnonymizerConfig>;
  // If true, the system prompt is anonymized too. Defaults to true.
  anonymizeSystemPrompt?: boolean;
}

function mergeConfig(partial?: Partial<AnonymizerConfig>): AnonymizerConfig {
  if (!partial) return DEFAULT_CONFIG;
  return {
    detectors: { ...DEFAULT_CONFIG.detectors, ...(partial.detectors || {}) },
    idMinLength: partial.idMinLength ?? DEFAULT_CONFIG.idMinLength,
    placeholderStyle: partial.placeholderStyle ?? DEFAULT_CONFIG.placeholderStyle,
  };
}

router.post('/anonymize', async (req, res) => {
  const start = Date.now();
  const input = req.body as AnonymizeInput;
  if (typeof input.text !== 'string') return sendError(res, 400, 'MISSING_FIELDS', 'text is required');

  try {
    const cfg = mergeConfig(input.config);
    const result = anonymize(input.text, input.rules || [], cfg);
    sendSuccess(res, result, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

router.post('/deanonymize', async (req, res) => {
  const start = Date.now();
  const input = req.body as DeanonymizeInput;
  if (typeof input.text !== 'string') return sendError(res, 400, 'MISSING_FIELDS', 'text is required');
  if (!Array.isArray(input.mapping)) return sendError(res, 400, 'MISSING_FIELDS', 'mapping array is required');

  try {
    const restored = deanonymize(input.text, input.mapping);
    sendSuccess(res, { restoredText: restored }, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

router.post('/ai-complete', async (req, res) => {
  const start = Date.now();
  const input = req.body as AiCompleteInput;

  if (!input.credentials?.provider || !input.credentials?.apiKey) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.provider and credentials.apiKey are required');
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    return sendError(res, 400, 'MISSING_FIELDS', 'messages array is required');
  }

  try {
    const cfg = mergeConfig(input.config);
    const rules = input.rules || [];
    const anonymizeSystem = input.anonymizeSystemPrompt !== false && !!input.systemPrompt;

    // 1) Build the list of strings to anonymize as a single batch so the
    // mapping is shared across all messages (and the system prompt).
    const texts: string[] = [];
    if (anonymizeSystem) texts.push(input.systemPrompt!);
    for (const m of input.messages) texts.push(m.content);

    const { anonymizedTexts, mapping } = anonymizeMany(texts, rules, cfg);

    let cursor = 0;
    const anonSystemPrompt = anonymizeSystem ? anonymizedTexts[cursor++] : input.systemPrompt;
    const anonMessages = input.messages.map((m) => ({ role: m.role, content: anonymizedTexts[cursor++] }));

    // 2) Call the AI provider with anonymized content.
    const aiOpts = {
      model: input.model,
      maxTokens: input.maxTokens,
      systemPrompt: anonSystemPrompt,
      temperature: input.temperature,
    };

    let aiResult: any;
    switch (input.credentials.provider) {
      case 'anthropic':
        aiResult = await anthropicComplete(input.credentials.apiKey, anonMessages, aiOpts);
        break;
      case 'openai':
        aiResult = await openaiComplete(input.credentials.apiKey, anonMessages, aiOpts);
        break;
      case 'gemini':
        aiResult = await geminiComplete(input.credentials.apiKey, anonMessages, aiOpts);
        break;
      default:
        return sendError(res, 400, 'INVALID_FIELD', `Unknown provider: ${input.credentials.provider}`);
    }

    // 3) Deanonymize the AI response so placeholders are restored to
    // their original values for the caller.
    const anonContent: string = aiResult.content || '';
    const restoredContent = deanonymize(anonContent, mapping);

    sendSuccess(
      res,
      {
        content: restoredContent,
        anonymizedContent: anonContent,
        mapping,
        sentMessages: anonMessages,
        sentSystemPrompt: anonSystemPrompt,
        usage: aiResult.usage,
        stopReason: aiResult.stopReason || aiResult.finishReason,
      },
      { durationMs: Date.now() - start, provider: input.credentials.provider },
    );
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: input.credentials.provider,
    });
  }
});

const ruleSchema = {
  type: 'object',
  required: ['term', 'category'],
  properties: {
    term: { type: 'string' },
    category: { type: 'string' },
    caseSensitive: { type: 'boolean', default: false },
  },
};

const configSchema = {
  type: 'object',
  description: 'Partial config — fields not set fall back to defaults (all detectors enabled, idMinLength=10, brackets style)',
  properties: {
    detectors: {
      type: 'object',
      description: 'Per-detector toggle flags',
    },
    idMinLength: { type: 'number', default: 10 },
    placeholderStyle: { type: 'string', enum: ['brackets', 'curly'], default: 'brackets' },
  },
};

export const anonymiumTool: ToolDefinition = {
  name: 'anonymium',
  description: 'Privacy-preserving AI proxy — anonymize PII before calling AI, restore originals on response',
  actions: [
    {
      action: 'anonymize',
      description: 'Detect and replace PII in text with placeholders — returns anonymized text + mapping',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          rules: { type: 'array', items: ruleSchema, description: 'Manual rules for custom terms' },
          config: configSchema,
        },
      },
    },
    {
      action: 'deanonymize',
      description: 'Restore placeholders back to their original values using a mapping',
      inputSchema: {
        type: 'object',
        required: ['text', 'mapping'],
        properties: {
          text: { type: 'string' },
          mapping: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    {
      action: 'ai-complete',
      description: 'Round-trip privacy proxy: anonymize messages → call AI provider → restore placeholders in response. Returns the deanonymized AI content plus the anonymized payload that was sent so callers can audit what crossed the boundary.',
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
          rules: { type: 'array', items: ruleSchema },
          config: configSchema,
          anonymizeSystemPrompt: { type: 'boolean', default: true, description: 'Anonymize the system prompt too. Set false if it contains literal placeholder examples.' },
        },
      },
    },
  ],
  router,
};
