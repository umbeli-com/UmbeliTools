import { UmbeliToolsCore } from '../client.js';
import type { ToolResponse } from '../types.js';

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface AITextContentBlock {
  type: 'text';
  text: string;
}

/**
 * Image block. `image` accepts a base64 data URL (`data:image/png;base64,...`),
 * bare base64 (then set `mediaType`), or an `https://` URL. The service maps it
 * to Anthropic image blocks, OpenAI `image_url` parts, or Gemini `inlineData`.
 * Gemini cannot read remote URLs — send base64 when the chain may reach it.
 */
export interface AIImageContentBlock {
  type: 'image';
  image: string;
  mediaType?: string;
}

export type AIContentBlock = AITextContentBlock | AIImageContentBlock;

export interface AIMessage {
  role: 'user' | 'assistant' | 'system' | string;
  content: string | AIContentBlock[];
}

/** One provider slot in a failover chain. */
export interface AIProviderCredential {
  provider: AIProvider;
  apiKey: string;
  /** Model for this provider — model IDs are not portable across providers. */
  model?: string;
}

/**
 * Either a single provider or an ordered `providers` chain (tried first to last).
 * Entries with an empty `apiKey` are skipped, so `process.env.X ?? ''` is fine.
 */
export interface AICredentials {
  provider?: AIProvider;
  apiKey?: string;
  providers?: AIProviderCredential[];
}

export interface AICompleteInput {
  credentials: AICredentials;
  messages: AIMessage[];
  systemPrompt?: string;
  /** Applies to the first provider in the chain only. */
  model?: string;
  maxTokens?: number;
  /**
   * Sampling temperature. Dropped before the request on Anthropic models that
   * reject sampling parameters (Claude 4.6+/5 families, including the service
   * default `claude-sonnet-5`) — steer those with the prompt instead.
   */
  temperature?: number;
  /** Also fail over on 401/403. Off by default: only transport/408/429/5xx fail over. */
  failoverOnAuthErrors?: boolean;
}

export interface AICompleteResult {
  content: string;
  usage?: Record<string, unknown>;
  /** Anthropic. */
  stopReason?: string | null;
  /** OpenAI. */
  finishReason?: string;
  /** Gemini. */
  candidates?: unknown;
  /** The provider that actually answered (also on `meta.provider`). */
  provider: AIProvider | string;
  [key: string]: unknown;
}

/** One failed provider in a failover chain, as reported in `meta.attempts`. */
export interface AIFailoverAttempt {
  provider: AIProvider;
  status?: number;
  message: string;
  failedOver: boolean;
}

export interface AIGenerateJsonInput {
  credentials: AICredentials;
  systemPrompt?: string;
  /** Shorthand for a single user message. Required unless `messages` is given. */
  userPrompt?: string;
  messages?: AIMessage[];
  /** JSON Schema for the payload — used natively by Anthropic's forced tool-use. */
  schema?: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  /**
   * Sampling temperature. Dropped before the request on Anthropic models that
   * reject sampling parameters (Claude 4.6+/5 families, including the service
   * default `claude-sonnet-5`) — steer those with the prompt instead.
   */
  temperature?: number;
  failoverOnAuthErrors?: boolean;
}

export interface AIGenerateJsonResult<T = unknown> {
  data: T | null;
  raw: string;
  usage?: Record<string, unknown>;
  provider: AIProvider | string;
  /** tool_use | tool_use_wrapped | tool_use_string | json_object | response_mime_type | text_fallback */
  mode: string;
}

export interface AIWebResearchInput {
  /** OpenAI API key (Responses API + web_search tool). */
  credentials: { apiKey: string };
  prompt: string;
  model?: string;
}

export interface AIWebResearchResult {
  content: string;
  /** Full OpenAI Responses payload (citations live in here). */
  raw?: unknown;
  provider: string;
  tool?: string;
  /** @deprecated never populated by the service — read `raw`. */
  citations?: Array<{ url: string; title?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface AIEmbedInput {
  /** OpenAI API key. `provider` is accepted for symmetry but must be 'openai'. */
  credentials: { apiKey: string; provider?: 'openai' };
  /** One string or a batch. Batches larger than 2048 are split automatically. */
  input: string | string[];
  /** Default: text-embedding-3-small. */
  model?: string;
  /** Output dimensions (text-embedding-3-* only). */
  dimensions?: number;
  /** Per-input character budget after whitespace normalisation (default 6000). */
  maxChars?: number;
  user?: string;
}

export interface AIEmbedInputMeta {
  index: number;
  chars: number;
  truncated: boolean;
  /** true when the input normalised to an empty string and was not sent upstream. */
  empty: boolean;
}

export interface AIEmbedResult {
  provider: 'openai';
  model: string;
  /** Vector length, or null when nothing was embedded. */
  dimensions: number | null;
  count: number;
  /** Convenience for the single-string case: the first vector, or null. */
  embedding: number[] | null;
  /** Index-aligned with `input`; `null` where the input was empty. */
  embeddings: Array<number[] | null>;
  inputs: AIEmbedInputMeta[];
  skipped: number[];
  usage: { prompt_tokens?: number; total_tokens?: number } | null;
  batches: number;
}

export class AiTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /**
   * Text (and image) completion via Anthropic / OpenAI / Gemini.
   * Pass `credentials.providers` for an ordered failover chain.
   */
  complete(input: AICompleteInput) {
    return this.core.request<AICompleteResult>('ai', 'complete', input);
  }

  /** Same as `complete`, but keeps `meta` (`provider`, `attempts`, `durationMs`). */
  completeWithMeta(input: AICompleteInput): Promise<ToolResponse<AICompleteResult>> {
    return this.core.call<AICompleteResult>('ai', 'complete', input);
  }

  /** Structured JSON via provider-native JSON mode. Pass a generic to type the payload. */
  generateJson<T = unknown>(input: AIGenerateJsonInput) {
    return this.core.request<AIGenerateJsonResult<T>>('ai', 'generate-json', input);
  }

  /** Web-grounded research via OpenAI Responses + web_search. */
  webResearch(input: AIWebResearchInput) {
    return this.core.request<AIWebResearchResult>('ai', 'web-research', input);
  }

  /** Vector embeddings via OpenAI /v1/embeddings (default text-embedding-3-small). */
  embed(input: AIEmbedInput) {
    return this.core.request<AIEmbedResult>('ai', 'embed', input);
  }
}
