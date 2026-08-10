import { UmbeliToolsCore } from '../client.js';

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
}

export interface AICredentials {
  provider: AIProvider;
  apiKey: string;
}

export interface AICompleteInput {
  credentials: AICredentials;
  messages: AIMessage[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AICompleteResult {
  content: string;
  usage?: Record<string, unknown>;
  stopReason?: string;
  provider: AIProvider;
  [key: string]: unknown;
}

export interface AIGenerateJsonInput {
  credentials: AICredentials;
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

export interface AIGenerateJsonResult<T = unknown> {
  data: T | null;
  raw: string;
  usage?: Record<string, unknown>;
}

export interface AIWebResearchInput {
  /** OpenAI API key (Responses API + web_search tool). */
  credentials: { apiKey: string };
  prompt: string;
  model?: string;
}

export interface AIWebResearchResult {
  content: string;
  citations?: Array<{ url: string; title?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export class AiTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Text completion via Anthropic / OpenAI / Gemini. */
  complete(input: AICompleteInput) {
    return this.core.request<AICompleteResult>('ai', 'complete', input);
  }

  /** Structured JSON output. Pass a generic to type the parsed payload. */
  generateJson<T = unknown>(input: AIGenerateJsonInput) {
    return this.core.request<AIGenerateJsonResult<T>>('ai', 'generate-json', input);
  }

  /** Web-grounded research via OpenAI Responses + web_search. */
  webResearch(input: AIWebResearchInput) {
    return this.core.request<AIWebResearchResult>('ai', 'web-research', input);
  }
}
