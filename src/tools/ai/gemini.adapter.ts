import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content, GenerationConfig, Part } from '@google/generative-ai';
import { ToolError } from '../../lib/errors';
import { normalizeMessages, partsToText } from './content';
import type { NormalizedMessage, NormalizedPart } from './content';
import type { AIMessage } from './types';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export interface GeminiOptions {
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GeminiJSONOptions extends GeminiOptions {
  schema?: Record<string, unknown>;
}

/**
 * Gemini takes images as inline base64 (`inlineData`). It has no equivalent of a
 * remote image URL on generateContent — remote files must go through the Files
 * API first — so a URL image block is rejected with a clear message instead of
 * being silently dropped.
 */
function toParts(parts: NormalizedPart[], where: string): Part[] {
  const mapped: Part[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      mapped.push({ text: part.text });
      continue;
    }
    if (part.url) {
      throw new ToolError(
        'INVALID_FIELD',
        `${where}: gemini cannot read remote image URLs — send the image as base64 (data URL) or use provider "openai"/"anthropic"`,
      );
    }
    if (part.base64) {
      mapped.push({ inlineData: { mimeType: part.mediaType || 'image/png', data: part.base64 } });
    }
  }
  return mapped;
}

function buildRequest(messages: AIMessage[], opts: GeminiOptions) {
  const normalized: NormalizedMessage[] = normalizeMessages(messages);
  const systemChunks: string[] = [];
  if (opts.systemPrompt) systemChunks.push(opts.systemPrompt);

  const turns: Array<{ role: 'user' | 'model'; parts: Part[] }> = [];
  normalized.forEach((message, index) => {
    if (message.role === 'system') {
      const text = partsToText(message.parts);
      if (text) systemChunks.push(text);
      return;
    }
    const parts = toParts(message.parts, `messages[${index}]`);
    if (!parts.length) return;
    turns.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  });

  const last = turns.pop();
  if (!last) throw new ToolError('MISSING_FIELDS', 'messages must contain at least one non-empty user message');
  // The Gemini SDK validates history client-side and throws when it does not
  // open on a user turn. Left alone that surfaces as a 502 PROVIDER_ERROR for
  // what is really a malformed request, so classify it here instead.
  if (turns.length && turns[0].role === 'model') {
    throw new ToolError(
      'INVALID_FIELD',
      'gemini requires the conversation to start with a user message — an assistant message cannot come first',
    );
  }

  return {
    systemInstruction: systemChunks.join('\n\n'),
    history: turns as Content[],
    lastParts: last.parts,
  };
}

function generationConfig(opts: GeminiOptions & { json?: boolean }): GenerationConfig | undefined {
  const config: GenerationConfig = {};
  if (opts.maxTokens) config.maxOutputTokens = opts.maxTokens;
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.json) config.responseMimeType = 'application/json';
  return Object.keys(config).length ? config : undefined;
}

async function run(apiKey: string, messages: AIMessage[], opts: GeminiOptions & { json?: boolean }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const { systemInstruction, history, lastParts } = buildRequest(messages, opts);

  const model = genAI.getGenerativeModel({
    model: opts.model || DEFAULT_MODEL,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(generationConfig(opts) ? { generationConfig: generationConfig(opts) } : {}),
  });

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastParts);
  const response = result.response;

  return {
    content: response.text(),
    candidates: response.candidates,
    usage: response.usageMetadata,
    provider: 'gemini',
  };
}

export async function geminiComplete(apiKey: string, messages: AIMessage[], opts: GeminiOptions = {}) {
  return run(apiKey, messages, opts);
}

/**
 * Native JSON mode via `responseMimeType: 'application/json'`. A caller schema is
 * passed to the model as an instruction rather than as `responseSchema`, because
 * Gemini's response schema only accepts a narrow OpenAPI subset and 400s on the
 * JSON Schema keywords the other two providers accept.
 */
export async function geminiGenerateJSON(apiKey: string, messages: AIMessage[], opts: GeminiJSONOptions = {}) {
  const instructions: string[] = [];
  if (opts.systemPrompt) instructions.push(opts.systemPrompt);
  if (opts.schema) {
    instructions.push(`Respond with JSON matching this JSON Schema:\n${JSON.stringify(opts.schema)}`);
  }

  const result = await run(apiKey, messages, {
    model: opts.model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    systemPrompt: instructions.join('\n\n') || undefined,
    json: true,
  });

  let data: unknown;
  try {
    data = JSON.parse(result.content);
  } catch {
    data = undefined;
  }

  return { ...result, data, mode: data === undefined ? ('text' as const) : ('response_mime_type' as const) };
}
