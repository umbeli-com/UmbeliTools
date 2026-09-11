import Anthropic from '@anthropic-ai/sdk';
import { normalizeMessages, partsToText } from './content';
import type { NormalizedMessage, NormalizedPart } from './content';
import type { AIMessage } from './types';

/**
 * Current Claude line: Opus 5 (claude-opus-5), Sonnet 5 (claude-sonnet-5),
 * Haiku 4.5 (claude-haiku-4-5-20251001), Fable 5.1 (claude-fable-5-1).
 */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';

const JSON_TOOL_NAME = 'emit_json';

/**
 * Model families that reject the sampling parameters outright.
 *
 * `temperature` / `top_p` / `top_k` return a 400 `invalid_request_error` on the
 * Claude 4.6+ and 5 lines (Opus 4.6/4.7/4.8/5, Sonnet 4.6/5, Fable, Mythos) —
 * including `claude-sonnet-5`, which is this adapter's default. Since
 * `temperature` is a documented input of `ai/complete`, `ai/generate-json` AND
 * `anonymium/ai-complete`, forwarding it verbatim turned every temperature-
 * bearing Anthropic call into a 400 — and a 400 is precisely the status the
 * failover chain refuses to retry, so the request died on the first provider
 * instead of moving to the next one. Older models (Haiku 4.5, Sonnet 4.5,
 * Claude 3.x, …) still accept it, so the parameter is dropped per model rather
 * than removed from the API.
 */
const NO_SAMPLING_MODEL_RE = /^claude-(?:opus-(?:4-[678]|5)|sonnet-(?:4-6|5)|fable-|mythos-)/i;

/** True when `model` still accepts `temperature` / `top_p` / `top_k`. */
export function acceptsSamplingParams(model: string): boolean {
  return !NO_SAMPLING_MODEL_RE.test(model.trim());
}

/** `{ temperature }` when the caller asked for it and the model accepts it, else `{}`. */
function samplingParams(model: string, temperature?: number): { temperature?: number } {
  return temperature !== undefined && acceptsSamplingParams(model) ? { temperature } : {};
}

export interface AnthropicOptions {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
}

export interface AnthropicJSONOptions extends AnthropicOptions {
  /** JSON Schema for the payload. Used verbatim as the forced tool's input_schema. */
  schema?: Record<string, unknown>;
}

function toContentBlocks(parts: NormalizedPart[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.url) {
      blocks.push({ type: 'image', source: { type: 'url', url: part.url } });
      continue;
    }
    if (part.base64) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (part.mediaType || 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: part.base64,
        },
      });
    }
  }
  return blocks;
}

/** System-role messages fold into the `system` parameter — Anthropic has no system role. */
function buildRequest(messages: AIMessage[], opts: AnthropicOptions) {
  const normalized: NormalizedMessage[] = normalizeMessages(messages);
  const systemChunks: string[] = [];
  if (opts.systemPrompt) systemChunks.push(opts.systemPrompt);

  const conversation: Anthropic.MessageParam[] = [];
  for (const message of normalized) {
    if (message.role === 'system') {
      const text = partsToText(message.parts);
      if (text) systemChunks.push(text);
      continue;
    }
    const content = toContentBlocks(message.parts);
    if (!content.length) continue;
    conversation.push({ role: message.role, content });
  }

  return { system: systemChunks.join('\n\n'), messages: conversation };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export async function anthropicComplete(
  apiKey: string,
  messages: AIMessage[],
  opts: AnthropicOptions = {},
) {
  const client = new Anthropic({ apiKey });
  const { system, messages: conversation } = buildRequest(messages, opts);
  const model = opts.model || ANTHROPIC_DEFAULT_MODEL;

  const message = await client.messages.create({
    model,
    max_tokens: opts.maxTokens || 2048,
    ...(system && { system }),
    ...samplingParams(model, opts.temperature),
    messages: conversation,
  });

  return {
    content: textOf(message),
    usage: message.usage,
    stopReason: message.stop_reason,
    provider: 'anthropic',
  };
}

/**
 * Native structured output: a single tool is declared and forced with
 * `tool_choice: { type: 'tool' }`, so the model can only answer by filling the
 * schema. With a caller schema the tool input IS the payload; without one the
 * model fills a `json` string field, which preserves arbitrary shapes (objects
 * AND arrays) the way the old free-text extraction did.
 */
export async function anthropicGenerateJSON(
  apiKey: string,
  messages: AIMessage[],
  opts: AnthropicJSONOptions = {},
) {
  const client = new Anthropic({ apiKey });
  const { system, messages: conversation } = buildRequest(messages, opts);

  const hasSchema = !!opts.schema && typeof opts.schema === 'object';
  const schemaIsObject = hasSchema && (opts.schema as { type?: unknown }).type === 'object';

  let inputSchema: Anthropic.Tool.InputSchema;
  let description: string;

  if (hasSchema && schemaIsObject) {
    inputSchema = opts.schema as unknown as Anthropic.Tool.InputSchema;
    description = 'Return the answer as structured JSON matching this schema. You must call this tool.';
  } else if (hasSchema) {
    // Non-object root (array, etc.): Anthropic requires an object root, so wrap.
    inputSchema = {
      type: 'object',
      properties: { result: opts.schema as unknown },
      required: ['result'],
    };
    description = 'Return the answer in "result", matching its schema. You must call this tool.';
  } else {
    inputSchema = {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'The JSON document requested by the instructions, serialized as a JSON string.',
        },
      },
      required: ['json'],
    };
    description = 'Return the requested JSON document, serialized into the "json" field. You must call this tool.';
  }

  const model = opts.model || ANTHROPIC_DEFAULT_MODEL;
  const message = await client.messages.create({
    model,
    max_tokens: opts.maxTokens || 2048,
    ...(system && { system }),
    ...samplingParams(model, opts.temperature),
    messages: conversation,
    tools: [{ name: JSON_TOOL_NAME, description, input_schema: inputSchema }],
    tool_choice: { type: 'tool', name: JSON_TOOL_NAME },
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === JSON_TOOL_NAME,
  );

  if (!toolUse) {
    // The model answered in prose despite the forced tool (should not happen).
    return {
      content: textOf(message),
      data: undefined as unknown,
      mode: 'text' as const,
      usage: message.usage,
      stopReason: message.stop_reason,
      provider: 'anthropic',
    };
  }

  const input = toolUse.input as Record<string, unknown>;
  let data: unknown;
  let mode: 'tool_use' | 'tool_use_wrapped' | 'tool_use_string' | 'text';

  if (hasSchema && schemaIsObject) {
    data = input;
    mode = 'tool_use';
  } else if (hasSchema) {
    data = input?.result;
    mode = 'tool_use_wrapped';
  } else {
    mode = 'tool_use_string';
    const serialized = typeof input?.json === 'string' ? input.json : '';
    try {
      data = JSON.parse(serialized);
    } catch {
      data = undefined;
    }
    return {
      content: serialized,
      data,
      mode,
      usage: message.usage,
      stopReason: message.stop_reason,
      provider: 'anthropic',
    };
  }

  return {
    content: JSON.stringify(data ?? null),
    data,
    mode,
    usage: message.usage,
    stopReason: message.stop_reason,
    provider: 'anthropic',
  };
}
