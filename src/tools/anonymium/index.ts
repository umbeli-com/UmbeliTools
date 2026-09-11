import { Router } from 'express';
import type { Response } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { anonymize, deanonymize, anonymizeMany } from './anonymizer';
import type { AnonymizerConfig, CategoryType, MappingEntry, Rule } from './types';
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

interface AnonymizeManyInput {
  texts: string[];
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
    anonymizationProfile: partial.anonymizationProfile ?? DEFAULT_CONFIG.anonymizationProfile,
    ultraStrict: partial.ultraStrict ?? DEFAULT_CONFIG.ultraStrict,
    phoneRegion: partial.phoneRegion ?? DEFAULT_CONFIG.phoneRegion,
  };
}

// The ported engine runs ~150 patterns plus an NLP pass over the whole text,
// roughly 6 ms per KB, and these routes are synchronous. express.json() allows a
// 2 MB body (ENV.JSON_BODY_LIMIT), which would be ~12 s of blocked event loop
// per request. Cap the text the engine is handed so one caller cannot starve the
// service; the limits are generous for real documents and the error is explicit.
const MAX_TEXT_CHARS = 512_000;
const MAX_BATCH_CHARS = 1_000_000;

function tooLong(res: Response, what: string, actual: number, max: number, start: number) {
  return sendError(
    res,
    413,
    'PAYLOAD_TOO_LARGE',
    `${what} is ${actual} characters; the maximum is ${max}`,
    undefined,
    { durationMs: Date.now() - start },
  );
}

router.post('/anonymize', async (req, res) => {
  const start = Date.now();
  const input = req.body as AnonymizeInput;
  if (typeof input.text !== 'string') return sendError(res, 400, 'MISSING_FIELDS', 'text is required');
  if (input.text.length > MAX_TEXT_CHARS) return tooLong(res, 'text', input.text.length, MAX_TEXT_CHARS, start);

  try {
    const cfg = mergeConfig(input.config);
    const result = anonymize(input.text, input.rules || [], cfg);
    sendSuccess(res, result, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

router.post('/anonymize-many', async (req, res) => {
  const start = Date.now();
  const input = req.body as AnonymizeManyInput;
  if (!Array.isArray(input.texts)) {
    return sendError(res, 400, 'MISSING_FIELDS', 'texts array is required');
  }
  if (input.texts.some((t) => typeof t !== 'string')) {
    return sendError(res, 400, 'INVALID_FIELD', 'texts must contain only strings');
  }
  const oversized = input.texts.findIndex((t) => t.length > MAX_TEXT_CHARS);
  if (oversized !== -1) {
    return tooLong(res, `texts[${oversized}]`, input.texts[oversized].length, MAX_TEXT_CHARS, start);
  }
  const batchChars = input.texts.reduce((n, t) => n + t.length, 0);
  if (batchChars > MAX_BATCH_CHARS) return tooLong(res, 'texts (combined)', batchChars, MAX_BATCH_CHARS, start);

  try {
    const cfg = mergeConfig(input.config);
    const result = anonymizeMany(input.texts, input.rules || [], cfg);
    // anonymizeMany guarantees this, but the contract callers depend on is
    // positional alignment — so it is checked at the boundary too.
    if (result.anonymizedTexts.length !== input.texts.length) {
      return sendError(res, 500, 'INTERNAL_ERROR', 'anonymized text count does not match input count');
    }
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
  if (input.messages.some((m) => typeof m?.content !== 'string')) {
    return sendError(res, 400, 'INVALID_FIELD', 'every message needs a string content');
  }
  const promptChars =
    (input.systemPrompt?.length ?? 0) + input.messages.reduce((n, m) => n + m.content.length, 0);
  if (promptChars > MAX_BATCH_CHARS) {
    return tooLong(res, 'messages (combined)', promptChars, MAX_BATCH_CHARS, start);
  }

  try {
    const cfg = mergeConfig(input.config);
    const rules = input.rules || [];
    const anonymizeSystem = input.anonymizeSystemPrompt !== false && !!input.systemPrompt;

    // 1) Anonymize every string as one batch so the mapping is shared across
    // all messages (and the system prompt) — each text is still rewritten on
    // its own, so slot i of the output always belongs to slot i of the input.
    const texts: string[] = [];
    if (anonymizeSystem) texts.push(input.systemPrompt!);
    for (const m of input.messages) texts.push(m.content);

    const { anonymizedTexts, mapping } = anonymizeMany(texts, rules, cfg);
    if (anonymizedTexts.length !== texts.length) {
      return sendError(res, 500, 'INTERNAL_ERROR', 'anonymized text count does not match input count', undefined, {
        durationMs: Date.now() - start,
      });
    }

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

// `satisfies` keeps this list honest: a typo or a removed category fails the
// build instead of silently publishing a category the engine cannot emit.
const CATEGORIES = [
  'PERSON', 'ORGANIZATION', 'COMPANY', 'BANK_NAME', 'EMAIL', 'PHONE', 'ADDRESS',
  'PRICE', 'IBAN', 'BANK_INSTITUTION', 'BANK_TRANSIT', 'BANK_ACCOUNT', 'SWIFT_CODE',
  'CREDIT_CARD', 'CARD_EXPIRY', 'CVV', 'CARD', 'SALARY',
  'SSN', 'SIN', 'NIR', 'SIRET', 'SIREN', 'COMPANY_ID', 'APE_CODE', 'VAT', 'GOV_ID',
  'PASSPORT', 'LICENSE', 'DRIVER_LICENSE', 'HEALTH_CARD', 'IMMIGRATION_ID',
  'WORK_PERMIT', 'STUDY_PERMIT',
  'URL', 'HANDLE', 'IP', 'MAC', 'API_KEY', 'PASSWORD', 'USERNAME', 'SESSION_ID',
  'UUID', 'CSRF_TOKEN', 'TRANSACTION_ID', 'HOST', 'IPV6', 'MAC_ADDRESS', 'TOKEN',
  'OTP_CODE', 'SOCIAL_URL', 'DOMAIN', 'DB_CONNECTION_STRING', 'DB_HOST', 'DB_USER',
  'DB_PASSWORD',
  'DATE', 'LOCATION', 'POSTAL_CODE', 'GPS_COORDINATES',
  'STUDENT_CODE', 'FILE_NUMBER', 'REFERENCE_ID', 'EMPLOYEE_ID', 'MEDICAL_RECORD',
  'HEALTH_ORGANIZATION', 'MEDICATION', 'LICENSE_PLATE', 'VIN', 'INSURANCE_POLICY',
  'CRYPTO_WALLET', 'INTERNAL_CODE', 'PROJECT', 'CLIENT', 'ID', 'CUSTOM',
] as const satisfies readonly CategoryType[];

const DETECTOR_FLAGS = Object.keys(DEFAULT_CONFIG.detectors);

const ruleSchema = {
  type: 'object',
  required: ['term', 'category'],
  description: 'An explicit caller rule. It outranks every regex/NER guess it overlaps.',
  properties: {
    term: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
    caseSensitive: { type: 'boolean', default: false },
  },
};

const mappingEntrySchema = {
  type: 'object',
  required: ['original', 'placeholder', 'category'],
  properties: {
    id: { type: 'string' },
    original: { type: 'string' },
    placeholder: { type: 'string', description: 'e.g. "[PERSON_1]"' },
    category: { type: 'string', enum: CATEGORIES },
    source: { type: 'string', enum: ['regex', 'manual', 'ner', 'similarity'] },
    count: { type: 'number' },
  },
};

const configSchema = {
  type: 'object',
  description:
    'Partial config — fields not set fall back to defaults (all detectors enabled, idMinLength=10, brackets style, profile "general", phoneRegion "CA")',
  properties: {
    detectors: {
      type: 'object',
      description: 'Per-detector toggle flags (all default true)',
      properties: Object.fromEntries(DETECTOR_FLAGS.map((k) => [k, { type: 'boolean', default: true }])),
    },
    idMinLength: { type: 'number', default: 10, description: 'Minimum length of a bare alphanumeric internal ID' },
    placeholderStyle: { type: 'string', enum: ['brackets', 'curly'], default: 'brackets' },
    anonymizationProfile: {
      type: 'string',
      enum: ['general', 'academic', 'hr', 'legal'],
      default: 'general',
      description: 'Contextual preset — non-general profiles enable the broad line/table-oriented person and code detectors',
    },
    ultraStrict: {
      type: 'boolean',
      default: false,
      description: 'Enable the broad contextual detectors regardless of profile (higher recall, more over-redaction)',
    },
    phoneRegion: {
      type: 'string',
      default: 'CA',
      description: 'ISO 3166-1 alpha-2 region used to parse locally formatted phone numbers',
    },
  },
};

export const anonymiumTool: ToolDefinition = {
  name: 'anonymium',
  description:
    'Privacy-preserving AI proxy — detect and mask PII (FR/QC/CA-aware: NAS/SIN, RAMQ, NEQ/TPS/TVQ, postal codes, plates, permits, NIR/SIRET/TVA) before calling AI, restore originals on response',
  actions: [
    {
      action: 'anonymize',
      description: 'Detect and replace PII in text with placeholders — returns anonymized text + mapping + detections',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', maxLength: 512000 },
          rules: { type: 'array', items: ruleSchema, description: 'Manual rules for custom terms — these win over any overlapping automatic detection' },
          config: configSchema,
        },
      },
    },
    {
      action: 'anonymize-many',
      description:
        'Anonymize several texts against ONE shared mapping, so the same value gets the same placeholder everywhere. Output is positionally aligned with the input: anonymizedTexts[i] is always texts[i].',
      inputSchema: {
        type: 'object',
        required: ['texts'],
        properties: {
          texts: { type: 'array', items: { type: 'string', maxLength: 512000 }, description: 'Up to 512 000 characters each, 1 000 000 combined' },
          rules: { type: 'array', items: ruleSchema },
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
          mapping: { type: 'array', items: mappingEntrySchema },
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
