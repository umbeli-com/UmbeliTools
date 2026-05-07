// Ported from Anonymium — kept in sync with that app's detection categories.

export type CategoryType =
  | 'PERSON' | 'COMPANY' | 'EMAIL' | 'PHONE' | 'ADDRESS'
  | 'PRICE' | 'IBAN' | 'CARD' | 'SALARY'
  | 'SSN' | 'NIR' | 'SIRET' | 'VAT' | 'GOV_ID' | 'PASSPORT' | 'LICENSE'
  | 'URL' | 'HANDLE' | 'IP' | 'MAC' | 'API_KEY' | 'PASSWORD'
  | 'DATE' | 'INTERNAL_CODE' | 'PROJECT' | 'CLIENT' | 'ID' | 'CUSTOM';

export type SourceType = 'regex' | 'manual' | 'ner';
export type PlaceholderStyle = 'brackets' | 'curly';

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

export interface AnonymizerConfig {
  detectors: {
    email: boolean; phone: boolean; person: boolean; organization: boolean; address: boolean;
    price: boolean; iban: boolean; creditCard: boolean; salary: boolean;
    governmentId: boolean; passport: boolean; driverLicense: boolean;
    url: boolean; socialHandle: boolean; ipAddress: boolean; macAddress: boolean;
    apiKey: boolean; password: boolean;
    date: boolean; internalCode: boolean;
  };
  idMinLength: number;
  placeholderStyle: PlaceholderStyle;
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
    apiKey: true, password: true,
    date: true, internalCode: true,
  },
  idMinLength: 10,
  placeholderStyle: 'brackets',
};
