export type AIProvider = 'anthropic' | 'openai' | 'gemini';

/**
 * Text block. Identical across every provider.
 */
export interface AITextContentBlock {
  type: 'text';
  text: string;
}

/**
 * Image block, accepted in whatever shape the caller already has it in:
 *
 *   { type: 'image', image: 'data:image/png;base64,iVBORw0...' }
 *   { type: 'image', image: '<bare base64>', mediaType: 'image/jpeg' }
 *   { type: 'image', image: 'https://cdn.example.com/card.jpg' }
 *   { type: 'image_url', image_url: { url: '...' } }            // OpenAI shape
 *   { type: 'image', source: { type: 'base64', media_type, data } } // Anthropic shape
 *
 * `image` + `mediaType` is the canonical form; the rest are accepted so apps
 * migrating off a private provider client do not have to rewrite payloads.
 */
export interface AIImageContentBlock {
  type: 'image' | 'image_url';
  image?: string;
  url?: string;
  mediaType?: string;
  media_type?: string;
  image_url?: string | { url?: string };
  source?:
    | string
    | {
        type?: string;
        data?: string;
        media_type?: string;
        mediaType?: string;
        url?: string;
      };
}

export type AIContentBlock = AITextContentBlock | AIImageContentBlock;

export interface AIMessage {
  role: string;
  content: string | AIContentBlock[];
}

/** One provider slot in a failover chain. */
export interface AIProviderCredential {
  provider: AIProvider;
  apiKey: string;
  /** Optional per-provider model override (model IDs differ across providers). */
  model?: string;
}

/**
 * Either a single provider (legacy shape, still supported) or an ordered
 * `providers` chain. Entries with an empty `apiKey` are skipped, so a caller can
 * pass `process.env.X ?? ''` for every provider and let the chain resolve itself.
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
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Also fail over on 401/403 (a bad key on one provider). Off by default:
   * the default chain only moves on for transport / 408 / 429 / 5xx failures.
   */
  failoverOnAuthErrors?: boolean;
}

export interface AIGenerateJSONInput {
  credentials: AICredentials;
  systemPrompt?: string;
  userPrompt?: string;
  /** Alternative to `userPrompt` — full message list, images included. */
  messages?: AIMessage[];
  /** JSON Schema for the expected payload. Used natively by Anthropic tool-use. */
  schema?: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  failoverOnAuthErrors?: boolean;
}

export interface AIWebResearchInput {
  credentials: {
    apiKey: string;
  };
  prompt: string;
  model?: string;
}

export interface AIEmbedInput {
  credentials: {
    /** OpenAI API key. `provider` is accepted for symmetry but must be 'openai'. */
    apiKey: string;
    provider?: AIProvider;
  };
  /** One string or a batch. `text` / `texts` are accepted as aliases. */
  input?: string | string[];
  text?: string | string[];
  texts?: string | string[];
  model?: string;
  /** Output dimensions (text-embedding-3-* only). */
  dimensions?: number;
  /** Per-item character budget after whitespace normalisation (default 6000). */
  maxChars?: number;
  /** Opaque end-user id forwarded to OpenAI for abuse tracking. */
  user?: string;
}

/** Normalised completion envelope shared by every provider adapter. */
export interface AICompletionResult {
  content: string;
  usage?: unknown;
  /** Anthropic */
  stopReason?: string | null;
  /** OpenAI */
  finishReason?: string;
  /** Gemini */
  candidates?: unknown;
  provider: string;
}

export interface AIJSONResult extends AICompletionResult {
  /** Parsed payload, or undefined when the provider answered in prose. */
  data: unknown;
  /** How the payload was obtained: tool_use* | json_object | response_mime_type | text. */
  mode: string;
}
