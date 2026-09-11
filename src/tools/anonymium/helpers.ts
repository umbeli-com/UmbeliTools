import type { CategoryType, SourceType } from './types';

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Ported from Anonymum/src/utils/helpers.ts. Several categories share one
// placeholder LABEL (SSN and SIN both render as SIN, LICENSE renders as
// DRIVER_LICENSE...). Counters must be keyed by this label, never by the raw
// category: two categories collapsing onto the same label would each start at
// _1 and two different values would receive the same tag.
const PLACEHOLDER_ALIAS: Record<string, string> = {
  ORGANIZATION: 'ORGANIZATION',
  COMPANY: 'COMPANY',
  BANK_NAME: 'BANK_NAME',
  STUDENT_CODE: 'STUDENT_CODE',
  FILE_NUMBER: 'FILE_NUMBER',
  USERNAME: 'USERNAME',
  SESSION_ID: 'SESSION_ID',
  DRIVER_LICENSE: 'DRIVER_LICENSE',
  LICENSE: 'DRIVER_LICENSE',
  SIN: 'SIN',
  SSN: 'SIN',
  HEALTH_CARD: 'HEALTH_CARD',
  BANK_INSTITUTION: 'BANK_INSTITUTION',
  BANK_TRANSIT: 'BANK_TRANSIT',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  SWIFT_CODE: 'SWIFT_CODE',
  CREDIT_CARD: 'CREDIT_CARD',
  CARD_EXPIRY: 'CARD_EXPIRY',
  CVV: 'CVV',
  TOKEN: 'TOKEN',
  OTP_CODE: 'OTP_CODE',
  IPV6: 'IPV6',
  MAC_ADDRESS: 'MAC_ADDRESS',
  HOST: 'HOST',
  SOCIAL_URL: 'SOCIAL_URL',
  DOMAIN: 'DOMAIN',
  DB_CONNECTION_STRING: 'DB_CONNECTION_STRING',
  DB_HOST: 'DB_HOST',
  DB_USER: 'DB_USER',
  DB_PASSWORD: 'DB_PASSWORD',
  UUID: 'UUID',
  CSRF_TOKEN: 'CSRF_TOKEN',
  TRANSACTION_ID: 'TRANSACTION_ID',
  REFERENCE_ID: 'REFERENCE_ID',
  EMPLOYEE_ID: 'EMPLOYEE_ID',
  MEDICAL_RECORD: 'MEDICAL_RECORD',
  HEALTH_ORGANIZATION: 'HEALTH_ORGANIZATION',
  MEDICATION: 'MEDICATION',
  LICENSE_PLATE: 'LICENSE_PLATE',
  VIN: 'VIN',
  INSURANCE_POLICY: 'INSURANCE_POLICY',
  POSTAL_CODE: 'POSTAL_CODE',
  GPS_COORDINATES: 'GPS_COORDINATES',
  LOCATION: 'LOCATION',
  SIREN: 'SIREN',
  COMPANY_ID: 'COMPANY_ID',
  APE_CODE: 'APE_CODE',
};

/** Placeholder label for a category, AFTER alias resolution. */
export function placeholderLabel(category: string): string {
  return PLACEHOLDER_ALIAS[category] ?? category;
}

export function formatPlaceholder(category: string, index: number, style: 'brackets' | 'curly'): string {
  const placeholder = `${placeholderLabel(category)}_${index}`;
  return style === 'brackets' ? `[${placeholder}]` : `{${placeholder}}`;
}

export function sortByPosition<T extends { startIndex: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startIndex - b.startIndex);
}

export function rangesOverlap(
  a: { startIndex: number; endIndex: number },
  b: { startIndex: number; endIndex: number },
): boolean {
  return a.startIndex < b.endIndex && b.startIndex < a.endIndex;
}

// Ported from Anonymum's CATEGORY_PRIORITY. When two detectors claim the same
// span, the higher priority wins — NOT simply the longer match. A generic
// alphanumeric ID (15) must never evict an API key (98) that happens to be a
// character longer, and a phone-shaped run of digits (85) must not steal a
// labelled business number (COMPANY_ID 81 / VAT 78) it merely resembles.
export const CATEGORY_PRIORITY: Record<string, number> = {
  URL: 100,
  SOCIAL_URL: 99,
  API_KEY: 98,
  TOKEN: 97,
  DB_CONNECTION_STRING: 97,
  EMAIL: 96,
  PASSWORD: 95,
  OTP_CODE: 94,
  DB_PASSWORD: 93,
  DB_USER: 92,
  IBAN: 92,
  SESSION_ID: 91,
  UUID: 90,
  CSRF_TOKEN: 89,
  TRANSACTION_ID: 88,
  USERNAME: 88,
  IP: 87,
  IPV6: 86,
  MAC_ADDRESS: 86,
  MAC: 86,
  PHONE: 85,
  ADDRESS: 84,
  POSTAL_CODE: 83,
  STUDENT_CODE: 82,
  CRYPTO_WALLET: 82,
  FILE_NUMBER: 81,
  // Labelled and usually longer than the 9-digit fragment a lower-priority
  // detector would carve out of them.
  COMPANY_ID: 81,
  PROJECT: 81,
  MEDICAL_RECORD: 80,
  REFERENCE_ID: 80,
  EMPLOYEE_ID: 80,
  DB_HOST: 80,
  // SIRET/SIREN above SIN (79): "552 100 554" is a valid SIREN AND a
  // Luhn-valid Canadian SIN. In a French business context the SIREN label wins.
  SIRET: 80,
  SIREN: 80,
  SIN: 79,
  SSN: 79,
  NIR: 79,
  DRIVER_LICENSE: 78,
  VAT: 78,
  LICENSE: 78,
  HEALTH_CARD: 77,
  PASSPORT: 76,
  GOV_ID: 76,
  IMMIGRATION_ID: 76,
  WORK_PERMIT: 76,
  STUDY_PERMIT: 76,
  BANK_ACCOUNT: 75,
  BANK_TRANSIT: 74,
  INSURANCE_POLICY: 74,
  BANK_INSTITUTION: 73,
  BANK_NAME: 72,
  SWIFT_CODE: 71,
  CREDIT_CARD: 70,
  HOST: 70,
  ORGANIZATION: 69,
  HEALTH_ORGANIZATION: 69,
  PERSON: 68,
  COMPANY: 67,
  DATE: 66,
  SALARY: 65,
  LICENSE_PLATE: 60,
  APE_CODE: 60,
  VIN: 55,
  LOCATION: 55,
  GPS_COORDINATES: 55,
  MEDICATION: 50,
  DOMAIN: 45,
  PRICE: 45,
  HANDLE: 40,
  ID: 15,
  INTERNAL_CODE: 15,
  CLIENT: 14,
  CUSTOM: 12,
};

export function escapeRegexString(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Resolvable {
  startIndex: number;
  endIndex: number;
  category?: CategoryType | string;
  source?: SourceType | string;
}

const priorityOf = (item: Resolvable): number =>
  CATEGORY_PRIORITY[(item.category as string) ?? ''] ?? 10;

// A caller's explicit Rule is an instruction, not a guess: it outranks every
// heuristic. Previously an overlapping regex/NER hit could evict a manual rule
// simply by being one character longer — the caller asked for "Acme Corp" to be
// masked as a CLIENT and got the NER's COMPANY guess instead.
const tierOf = (item: Resolvable): number => (item.source === 'manual' ? 1 : 0);

/** Strictly-better comparison: manual rule > category priority > longer span. */
function beats(a: Resolvable, b: Resolvable): boolean {
  const tA = tierOf(a);
  const tB = tierOf(b);
  if (tA !== tB) return tA > tB;
  const pA = priorityOf(a);
  const pB = priorityOf(b);
  if (pA !== pB) return pA > pB;
  return a.endIndex - a.startIndex > b.endIndex - b.startIndex;
}

/**
 * Resolve overlapping detections down to a non-overlapping set.
 *
 * Order of authority:
 *   1. an explicit manual Rule always wins over a regex/NER hit;
 *   2. then the category priority table above;
 *   3. then the longer span.
 *
 * A winner evicts EVERY range it overlaps (not just the first one found), so a
 * long manual rule spanning two heuristic hits removes both instead of leaving
 * one of them behind to fragment the replacement.
 */
export function mergeRanges<T extends Resolvable>(items: T[]): T[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    const tA = tierOf(a);
    const tB = tierOf(b);
    if (tA !== tB) return tB - tA;
    const pA = priorityOf(a);
    const pB = priorityOf(b);
    if (pA !== pB) return pB - pA;
    return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
  });

  const keep: T[] = [];
  for (const current of sorted) {
    if (current.endIndex <= current.startIndex) continue;
    const clashes: number[] = [];
    for (let i = 0; i < keep.length; i++) {
      if (rangesOverlap(current, keep[i])) clashes.push(i);
    }
    if (clashes.length === 0) {
      keep.push(current);
      continue;
    }
    // Only displace the incumbents when the newcomer outranks all of them;
    // otherwise a weak wide match could wipe out a strong narrow one.
    if (!clashes.every((i) => beats(current, keep[i]))) continue;
    for (let k = clashes.length - 1; k >= 0; k--) keep.splice(clashes[k], 1);
    keep.push(current);
  }

  return sortByPosition(keep);
}
