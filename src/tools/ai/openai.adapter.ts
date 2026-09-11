import OpenAI from 'openai';
import { normalizeMessages, partsToText, toDataUrl } from './content';
import type { NormalizedMessage, NormalizedPart } from './content';
import type { AIMessage } from './types';

const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAIOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** response_format: { type: 'json_object' } */
  jsonMode?: boolean;
}

export interface OpenAIJSONOptions extends Omit<OpenAIOptions, 'jsonMode'> {
  schema?: Record<string, unknown>;
}

function toUserParts(parts: NormalizedPart[]): OpenAI.ChatCompletionContentPart[] {
  const mapped: OpenAI.ChatCompletionContentPart[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      mapped.push({ type: 'text', text: part.text });
      continue;
    }
    const url = toDataUrl(part);
    if (url) mapped.push({ type: 'image_url', image_url: { url } });
  }
  return mapped;
}

/**
 * OpenAI takes images as `image_url` parts (a remote URL or a base64 data URL),
 * and only on user messages — assistant/system content collapses to text.
 */
function buildMessages(messages: AIMessage[], systemPrompt?: string): OpenAI.ChatCompletionMessageParam[] {
  const normalized: NormalizedMessage[] = normalizeMessages(messages);
  const built: OpenAI.ChatCompletionMessageParam[] = [];

  if (systemPrompt) built.push({ role: 'system', content: systemPrompt });

  for (const message of normalized) {
    if (message.role === 'system') {
      const text = partsToText(message.parts);
      if (text) built.push({ role: 'system', content: text });
      continue;
    }
    if (message.role === 'assistant') {
      const text = partsToText(message.parts);
      if (text) built.push({ role: 'assistant', content: text });
      continue;
    }
    const parts = toUserParts(message.parts);
    if (!parts.length) continue;
    const onlyText = parts.every((p) => p.type === 'text');
    built.push({
      role: 'user',
      content: onlyText ? parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n') : parts,
    });
  }

  return built;
}

export async function openaiComplete(apiKey: string, messages: AIMessage[], opts: OpenAIOptions = {}) {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: opts.model || DEFAULT_MODEL,
    messages: buildMessages(messages, opts.systemPrompt),
    temperature: opts.temperature ?? 0.7,
    ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
    ...(opts.jsonMode && { response_format: { type: 'json_object' as const } }),
  });

  return {
    content: completion.choices[0]?.message?.content || '',
    usage: completion.usage,
    finishReason: completion.choices[0]?.finish_reason,
    provider: 'openai',
  };
}

/**
 * Native JSON mode. Two constraints handled here:
 *  - `json_object` requires the literal word "json" somewhere in the messages,
 *    otherwise the API returns 400.
 *  - `json_object` always yields an OBJECT at the root; a caller schema is passed
 *    to the model as an instruction (json_object takes no schema).
 */
export async function openaiGenerateJSON(apiKey: string, messages: AIMessage[], opts: OpenAIJSONOptions = {}) {
  const instructions: string[] = [];
  if (opts.systemPrompt) instructions.push(opts.systemPrompt);
  if (opts.schema) {
    instructions.push(`Respond with JSON matching this JSON Schema:\n${JSON.stringify(opts.schema)}`);
  }

  // Probe the TEXT only — base64 image data can contain "json" by chance and
  // would wrongly suppress the keyword the API requires.
  const probe = [instructions.join('\n'), ...normalizeMessages(messages).map((m) => partsToText(m.parts))].join('\n');
  if (!/json/i.test(probe)) {
    instructions.push('Respond with a single valid JSON object and nothing else.');
  }

  const result = await openaiComplete(apiKey, messages, {
    model: opts.model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    systemPrompt: instructions.join('\n\n') || undefined,
    jsonMode: true,
  });

  let data: unknown;
  try {
    data = JSON.parse(result.content);
  } catch {
    data = undefined;
  }

  return { ...result, data, mode: data === undefined ? ('text' as const) : ('json_object' as const) };
}
