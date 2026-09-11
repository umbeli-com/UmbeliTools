import { UmbeliToolsCore } from '../client.js';
import type { AIProvider } from './ai.js';

/**
 * Every category the engine can emit. Mirrors the server's CategoryType, which
 * is itself the contract with the Anonymum app — a placeholder means the same
 * thing on both sides.
 */
export type AnonymiumCategory =
  // Identity & contact
  | 'PERSON' | 'ORGANIZATION' | 'COMPANY' | 'BANK_NAME' | 'EMAIL' | 'PHONE' | 'ADDRESS'
  // Financial
  | 'PRICE' | 'IBAN' | 'BANK_INSTITUTION' | 'BANK_TRANSIT' | 'BANK_ACCOUNT' | 'SWIFT_CODE'
  | 'CREDIT_CARD' | 'CARD_EXPIRY' | 'CVV' | 'CARD' | 'SALARY'
  // Government / legal
  | 'SSN' | 'SIN' | 'NIR' | 'SIRET' | 'SIREN' | 'COMPANY_ID' | 'APE_CODE' | 'VAT' | 'GOV_ID'
  | 'PASSPORT' | 'LICENSE' | 'DRIVER_LICENSE' | 'HEALTH_CARD' | 'IMMIGRATION_ID'
  | 'WORK_PERMIT' | 'STUDY_PERMIT'
  // Network / technical
  | 'URL' | 'HANDLE' | 'IP' | 'MAC' | 'API_KEY' | 'PASSWORD' | 'USERNAME' | 'SESSION_ID'
  | 'UUID' | 'CSRF_TOKEN' | 'TRANSACTION_ID' | 'HOST' | 'IPV6' | 'MAC_ADDRESS' | 'TOKEN'
  | 'OTP_CODE' | 'SOCIAL_URL' | 'DOMAIN' | 'DB_CONNECTION_STRING' | 'DB_HOST' | 'DB_USER'
  | 'DB_PASSWORD'
  // Sensitive context
  | 'DATE' | 'LOCATION' | 'POSTAL_CODE' | 'GPS_COORDINATES'
  // Codes / generic
  | 'STUDENT_CODE' | 'FILE_NUMBER' | 'REFERENCE_ID' | 'EMPLOYEE_ID' | 'MEDICAL_RECORD'
  | 'HEALTH_ORGANIZATION' | 'MEDICATION' | 'LICENSE_PLATE' | 'VIN' | 'INSURANCE_POLICY'
  | 'CRYPTO_WALLET' | 'INTERNAL_CODE' | 'PROJECT' | 'CLIENT' | 'ID' | 'CUSTOM';

/** `similarity` marks an occurrence attached to an already-detected value. */
export type AnonymiumSource = 'regex' | 'manual' | 'ner' | 'similarity';
export type PlaceholderStyle = 'brackets' | 'curly';

/** Contextual severity preset. */
export type AnonymiumProfile = 'general' | 'academic' | 'hr' | 'legal';

export interface AnonymiumDetectorFlags {
  email: boolean; phone: boolean; person: boolean; organization: boolean; address: boolean;
  price: boolean; iban: boolean; creditCard: boolean; salary: boolean;
  governmentId: boolean; passport: boolean; driverLicense: boolean;
  url: boolean; socialHandle: boolean; ipAddress: boolean; macAddress: boolean;
  apiKey: boolean; password: boolean; otpCode: boolean;
  date: boolean; internalCode: boolean;
}

export interface AnonymiumConfig {
  detectors: AnonymiumDetectorFlags;
  /** Minimum length of a bare alphanumeric internal ID. Default 10. */
  idMinLength: number;
  /** Default `brackets` → `[PERSON_1]`; `curly` → `{PERSON_1}`. */
  placeholderStyle: PlaceholderStyle;
  /**
   * Non-`general` profiles turn on the broad line/table-oriented person and
   * code detectors (name lists, course codes, permanent codes). Default
   * `general`.
   */
  anonymizationProfile: AnonymiumProfile;
  /** Force those broad detectors on regardless of profile. Default `false`. */
  ultraStrict: boolean;
  /** ISO 3166-1 alpha-2 region for locally formatted phone numbers. Default `CA`. */
  phoneRegion: string;
}

export interface AnonymiumRule {
  term: string;
  category: AnonymiumCategory;
  caseSensitive?: boolean;
  /**
   * A rule is an instruction, not a guess: it wins over any regex/NER detection
   * it overlaps. Target the WHOLE value — a rule matching only part of a longer
   * automatic detection displaces that detection and leaves the rest in clear
   * text.
   */
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

export interface AnonymiumAnonymizeManyInput {
  texts: string[];
  rules?: AnonymiumRule[];
  config?: Partial<AnonymiumConfig>;
}

export interface AnonymiumAnonymizeManyResult {
  /** Positionally aligned with the input: `anonymizedTexts[i]` is `texts[i]`. */
  anonymizedTexts: string[];
  /** One mapping shared by every text, so a value keeps the same placeholder. */
  mapping: AnonymiumMappingEntry[];
}

export interface AnonymiumDeanonymizeInput {
  text: string;
  mapping: AnonymiumMappingEntry[];
}

export interface AnonymiumDeanonymizeResult {
  restoredText: string;
}

/** ai-complete needs a single provider — no failover chain on this route. */
export interface AnonymiumAiCredentials {
  provider: AIProvider;
  apiKey: string;
}

/** ai-complete anonymizes text, so message content must be a plain string. */
export interface AnonymiumMessage {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
}

export interface AnonymiumAiCompleteInput {
  credentials: AnonymiumAiCredentials;
  messages: AnonymiumMessage[];
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
  /** Exactly what crossed the boundary — audit these, not the input. */
  sentMessages: AnonymiumMessage[];
  sentSystemPrompt?: string;
  usage?: Record<string, unknown>;
  stopReason?: string;
}

export class AnonymiumTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Detect PII and replace it with `[CATEGORY_N]` placeholders. */
  anonymize(input: AnonymiumAnonymizeInput) {
    return this.core.request<AnonymiumAnonymizeResult>('anonymium', 'anonymize', input);
  }

  /**
   * Anonymize several texts against ONE shared mapping. Output stays
   * positionally aligned with the input, so `anonymizedTexts[i]` is always the
   * anonymized `texts[i]`.
   */
  anonymizeMany(input: AnonymiumAnonymizeManyInput) {
    return this.core.request<AnonymiumAnonymizeManyResult>('anonymium', 'anonymize-many', input);
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
