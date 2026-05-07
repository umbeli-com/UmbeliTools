export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface AICompleteInput {
  credentials: {
    provider: AIProvider;
    apiKey: string;
  };
  messages: { role: string; content: string }[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIGenerateJSONInput {
  credentials: {
    provider: AIProvider;
    apiKey: string;
  };
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

export interface AIWebResearchInput {
  credentials: {
    apiKey: string;
  };
  prompt: string;
  model?: string;
}
