import { BaseAdapter } from '../../lib/baseAdapter';

export const EMBEDDINGS_DEFAULT_MODEL = 'text-embedding-3-small';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_CHARS = 6000;
const MAX_CHARS_CEILING = 32000;
/** OpenAI caps a single /v1/embeddings call at 2048 inputs. */
const MAX_BATCH = 2048;

export interface EmbedOptions {
  model?: string;
  dimensions?: number;
  maxChars?: number;
  user?: string;
}

export interface EmbedInputMeta {
  index: number;
  chars: number;
  truncated: boolean;
  /** true when the text was empty (or whitespace only) and was not sent upstream. */
  empty: boolean;
}

export interface EmbedResult {
  provider: 'openai';
  model: string;
  dimensions: number | null;
  count: number;
  /** Convenience for the single-string case: the first vector, or null. */
  embedding: number[] | null;
  /** One entry per input, index-aligned. `null` where the input was empty. */
  embeddings: Array<number[] | null>;
  inputs: EmbedInputMeta[];
  /** Indexes that were skipped because they normalised to an empty string. */
  skipped: number[];
  usage: { prompt_tokens?: number; total_tokens?: number } | null;
  batches: number;
}

interface OpenAIEmbeddingsResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  model?: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/** Collapses every whitespace run to a single space and trims — the same shape Noesium feeds pgvector. */
export function normalizeEmbeddingText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function openaiEmbed(
  apiKey: string,
  input: string | string[],
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  const model = opts.model || EMBEDDINGS_DEFAULT_MODEL;
  const maxChars = Math.max(1, Math.min(opts.maxChars || DEFAULT_MAX_CHARS, MAX_CHARS_CEILING));
  const raw = Array.isArray(input) ? input : [input];

  const prepared = raw.map((value, index) => {
    const normalized = normalizeEmbeddingText(value);
    const truncated = normalized.length > maxChars;
    const text = truncated ? normalized.slice(0, maxChars) : normalized;
    return { index, text, truncated, empty: text.length === 0 };
  });

  const embeddings: Array<number[] | null> = prepared.map(() => null);
  const sendable = prepared.filter((item) => !item.empty);

  const adapter = new BaseAdapter({
    baseUrl: OPENAI_BASE_URL,
    defaultHeaders: { Authorization: `Bearer ${apiKey}` },
    timeout: 60_000,
  });

  const usage = { prompt_tokens: 0, total_tokens: 0 };
  let sawUsage = false;
  let resolvedModel = model;
  const batches = chunk(sendable, MAX_BATCH);

  for (const batch of batches) {
    const { data } = (await adapter.post('/embeddings', {
      body: {
        model,
        input: batch.map((item) => item.text),
        ...(opts.dimensions ? { dimensions: opts.dimensions } : {}),
        ...(opts.user ? { user: opts.user } : {}),
      },
    })) as { data: OpenAIEmbeddingsResponse };

    if (typeof data?.model === 'string') resolvedModel = data.model;
    if (data?.usage) {
      sawUsage = true;
      usage.prompt_tokens += data.usage.prompt_tokens ?? 0;
      usage.total_tokens += data.usage.total_tokens ?? 0;
    }

    (data?.data ?? []).forEach((entry, position) => {
      const batchIndex = typeof entry.index === 'number' ? entry.index : position;
      const target = batch[batchIndex];
      if (target && Array.isArray(entry.embedding)) embeddings[target.index] = entry.embedding;
    });
  }

  const firstVector = embeddings.find((vector): vector is number[] => Array.isArray(vector)) ?? null;

  return {
    provider: 'openai',
    model: resolvedModel,
    dimensions: firstVector ? firstVector.length : null,
    count: prepared.length,
    embedding: embeddings[0] ?? null,
    embeddings,
    inputs: prepared.map(({ index, text, truncated, empty }) => ({
      index,
      chars: text.length,
      truncated,
      empty,
    })),
    skipped: prepared.filter((item) => item.empty).map((item) => item.index),
    usage: sawUsage ? usage : null,
    batches: batches.length,
  };
}
