import { UmbeliToolsCore } from '../client.js';
import type { AICredentials, AIMessage } from './ai.js';

export type AnonymiumCategory =
  | 'PERSON' | 'COMPANY' | 'EMAIL' | 'PHONE' | 'ADDRESS'
  | 'PRICE' | 'IBAN' | 'CARD' | 'SALARY'
  | 'SSN' | 'NIR' | 'SIRET' | 'VAT' | 'GOV_ID' | 'PASSPORT' | 'LICENSE'
  | 'URL' | 'HANDLE' | 'IP' | 'MAC' | 'API_KEY' | 'PASSWORD'
  | 'DATE' | 'INTERNAL_CODE' | 'PROJECT' | 'CLIENT' | 'ID' | 'CUSTOM';

export type AnonymiumSource = 'regex' | 'manual' | 'ner';
export type PlaceholderStyle = 'brackets' | 'curly';

export interface AnonymiumDetectorFlags {
  email: boolean; phone: boolean; person: boolean; organization: boolean; address: boolean;
  price: boolean; iban: boolean; creditCard: boolean; salary: boolean;
  governmentId: boolean; passport: boolean; driverLicense: boolean;
  url: boolean; socialHandle: boolean; ipAddress: boolean; macAddress: boolean;
  apiKey: boolean; password: boolean;
  date: boolean; internalCode: boolean;
}

export interface AnonymiumConfig {
  detectors: AnonymiumDetectorFlags;
  idMinLength: number;
  placeholderStyle: PlaceholderStyle;
}

export interface AnonymiumRule {
  term: string;
  category: AnonymiumCategory;
  caseSensitive?: boolean;
}

export interface AnonymiumDetection {
  id: string;
  value: string;
  category: AnonymiumCategory;
  source: AnonymiumSource;
  startIndex: number;
  endIndex: number;
}

export interface AnonymiumMappingEntry {
  id: string;
  original: string;
  placeholder: string;
  category: AnonymiumCategory;
  source: AnonymiumSource;
  count: number;
}

export interface AnonymiumAnonymizeInput {
  text: string;
  rules?: AnonymiumRule[];
  config?: Partial<AnonymiumConfig>;
}

export interface AnonymiumAnonymizeResult {
  anonymizedText: string;
  mapping: AnonymiumMappingEntry[];
  detections: AnonymiumDetection[];
}

export interface AnonymiumDeanonymizeInput {
  text: string;
  mapping: AnonymiumMappingEntry[];
}

export interface AnonymiumDeanonymizeResult {
  restoredText: string;
}

export interface AnonymiumAiCompleteInput {
  credentials: AICredentials;
  messages: AIMessage[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  rules?: AnonymiumRule[];
  config?: Partial<AnonymiumConfig>;
  /** Anonymize the system prompt too (default `true`). */
  anonymizeSystemPrompt?: boolean;
}

export interface AnonymiumAiCompleteResult {
  /** Final AI content with originals restored. */
  content: string;
  /** Same content but with placeholders still in place (audit trail). */
  anonymizedContent: string;
  mapping: AnonymiumMappingEntry[];
  sentMessages: AIMessage[];
  usage?: Record<string, unknown>;
  provider: string;
  [key: string]: unknown;
}

export class AnonymiumTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Detect PII and replace it with `[CATEGORY_N]` placeholders. */
  anonymize(input: AnonymiumAnonymizeInput) {
    return this.core.request<AnonymiumAnonymizeResult>('anonymium', 'anonymize', input);
  }

  /** Restore originals from a mapping. */
  deanonymize(input: AnonymiumDeanonymizeInput) {
    return this.core.request<AnonymiumDeanonymizeResult>('anonymium', 'deanonymize', input);
  }

  /** Privacy round-trip: anonymize → call AI → deanonymize response. */
  aiComplete(input: AnonymiumAiCompleteInput) {
    return this.core.request<AnonymiumAiCompleteResult>('anonymium', 'ai-complete', input);
  }
}
