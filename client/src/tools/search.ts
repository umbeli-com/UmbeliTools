import { UmbeliToolsCore } from '../client.js';

export interface SearchGoogleInput {
  /** Serper API key. */
  credentials: { apiKey: string };
  query: string;
  country?: string;
  language?: string;
  numResults?: number;
  page?: number;
}

export interface SearchGoogleResult {
  organic?: Array<{ title: string; link: string; snippet?: string; [key: string]: unknown }>;
  knowledgeGraph?: Record<string, unknown>;
  [key: string]: unknown;
}

export class SearchTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Run a Google search via the Serper API. */
  google(input: SearchGoogleInput) {
    return this.core.request<SearchGoogleResult>('search', 'google', input);
  }
}
