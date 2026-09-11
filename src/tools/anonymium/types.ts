// Ported from Anonymum (src/types/index.ts) — kept in sync with that app's
// detection categories. The category list is the contract between the app and
// this service: a category that exists here but not there (or vice versa) means
// the two engines disagree about what a placeholder means.

export type CategoryType =
  // Identity & contact
  | 'PERSON'
  | 'ORGANIZATION'
  | 'COMPANY'
  | 'BANK_NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'ADDRESS'
  // Financial
  | 'PRICE'
  | 'IBAN'
  | 'BANK_INSTITUTION'
  | 'BANK_TRANSIT'
  | 'BANK_ACCOUNT'
  | 'SWIFT_CODE'
  | 'CREDIT_CARD'
  | 'CARD_EXPIRY'
  | 'CVV'
  | 'CARD'
  | 'SALARY'
  // Government / legal
  | 'SSN'
  | 'SIN'
  | 'NIR'
  | 'SIRET'
  | 'SIREN'
  | 'COMPANY_ID'
  | 'APE_CODE'
  | 'VAT'
  | 'GOV_ID'
  | 'PASSPORT'
  | 'LICENSE'
  | 'DRIVER_LICENSE'
  | 'HEALTH_CARD'
  | 'IMMIGRATION_ID'
  | 'WORK_PERMIT'
  | 'STUDY_PERMIT'
  // Network / technical
  | 'URL'
  | 'HANDLE'
  | 'IP'
  | 'MAC'
  | 'API_KEY'
  | 'PASSWORD'
  | 'USERNAME'
  | 'SESSION_ID'
  | 'UUID'
  | 'CSRF_TOKEN'
  | 'TRANSACTION_ID'
  | 'HOST'
  | 'IPV6'
  | 'MAC_ADDRESS'
  | 'TOKEN'
  | 'OTP_CODE'
  | 'SOCIAL_URL'
  | 'DOMAIN'
  | 'DB_CONNECTION_STRING'
  | 'DB_HOST'
  | 'DB_USER'
  | 'DB_PASSWORD'
  // Sensitive context
  | 'DATE'
  | 'LOCATION'
  | 'POSTAL_CODE'
  | 'GPS_COORDINATES'
  // Codes / generic
  | 'STUDENT_CODE'
  | 'FILE_NUMBER'
  | 'REFERENCE_ID'
  | 'EMPLOYEE_ID'
  | 'MEDICAL_RECORD'
  | 'HEALTH_ORGANIZATION'
  | 'MEDICATION'
  | 'LICENSE_PLATE'
  | 'VIN'
  | 'INSURANCE_POLICY'
  | 'CRYPTO_WALLET'
  | 'INTERNAL_CODE'
  | 'PROJECT'
  | 'CLIENT'
  | 'ID'
  | 'CUSTOM';

export type SourceType = 'regex' | 'manual' | 'ner' | 'similarity';
export type PlaceholderStyle = 'brackets' | 'curly';

/**
 * Contextual severity preset. `general` is the default; the others loosen the
 * guards on the broad, line-oriented detectors (standalone name lines, course
 * codes, name/code tables) that are too eager on arbitrary prose.
 */
export type AnonymizationProfile = 'general' | 'academic' | 'hr' | 'legal';

export interface Detection {
  id: string;
  value: string;
  category: CategoryType;
  source: SourceType;
  startIndex: number;
  endIndex: number;
}

export interface Rule {
  term: string;
  category: CategoryType;
  caseSensitive?: boolean;
}

export interface MappingEntry {
  id: string;
  original: string;
  placeholder: string;
  category: CategoryType;
  source: SourceType;
  count: number;
}

export interface DetectorFlags {
  // Identity & contact
  email: boolean;
  phone: boolean;
  person: boolean;
  organization: boolean;
  address: boolean;
  // Financial
  price: boolean;
  iban: boolean;
  creditCard: boolean;
  salary: boolean;
  // Government / legal
  governmentId: boolean;
  passport: boolean;
  driverLicense: boolean;
  // Network / technical
  url: boolean;
  socialHandle: boolean;
  ipAddress: boolean;
  macAddress: boolean;
  apiKey: boolean;
  password: boolean;
  otpCode: boolean;
  // Sensitive context
  date: boolean;
  // Generic
  internalCode: boolean;
}

export interface AnonymizerConfig {
  detectors: DetectorFlags;
  idMinLength: number;
  placeholderStyle: PlaceholderStyle;
  anonymizationProfile: AnonymizationProfile;
  ultraStrict: boolean;
  /**
   * Default region (ISO 3166-1 alpha-2) used to parse phone numbers written in
   * a local format. International numbers (`+`) are detected regardless.
   */
  phoneRegion?: string;
}

export interface AnonymizationResult {
  anonymizedText: string;
  mapping: MappingEntry[];
  detections: Detection[];
}

export const DEFAULT_CONFIG: AnonymizerConfig = {
  detectors: {
    email: true, phone: true, person: true, organization: true, address: true,
    price: true, iban: true, creditCard: true, salary: true,
    governmentId: true, passport: true, driverLicense: true,
    url: true, socialHandle: true, ipAddress: true, macAddress: true,
    apiKey: true, password: true, otpCode: true,
    date: true, internalCode: true,
  },
  idMinLength: 10,
  placeholderStyle: 'brackets',
  anonymizationProfile: 'general',
  ultraStrict: false,
  phoneRegion: 'CA',
};
