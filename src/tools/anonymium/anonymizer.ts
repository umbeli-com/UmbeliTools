// Ported from Anonymium/src/services/anonymizer.ts. Same detection
// algorithm — order-sensitive regex passes + NER + manual rules, then
// merge overlapping ranges (longer match wins) and emit consistent
// per-category placeholders.

import type {
  Detection,
  Rule,
  MappingEntry,
  AnonymizerConfig,
  CategoryType,
  AnonymizationResult,
} from './types';
import {
  EMAIL_REGEX, PHONE_REGEX, PRICE_REGEX, IBAN_REGEX, BIC_REGEX, URL_REGEX,
  HANDLE_REGEX, DATE_FR_REGEX, DATE_FR_LONG_REGEX, DATE_ISO_REGEX, DATE_EN_REGEX,
  DOB_REGEX, ADDRESS_FR_REGEX, ADDRESS_EN_REGEX, ZIP_US_REGEX,
  CREDIT_CARD_REGEX, CVV_REGEX, EXPIRY_REGEX, RIB_REGEX,
  NIR_REGEX, SIRET_REGEX, SIREN_REGEX, VAT_REGEX, SSN_US_REGEX,
  PASSPORT_REGEX, DRIVER_LICENSE_REGEX, IPV4_REGEX, IPV6_REGEX, MAC_REGEX,
  API_KEY_REGEX, JWT_REGEX, BEARER_REGEX, PASSWORD_LINE_REGEX, SALARY_REGEX,
  createIdRegex, findAllMatches, findTermInText,
} from './regex';
import { detectEntities } from './ner';
import { generateId, formatPlaceholder, sortByPosition, mergeRanges, escapeRegexString } from './helpers';

export function detectWithRegex(text: string, config: AnonymizerConfig): Detection[] {
  const detections: Detection[] = [];

  const overlapsAny = (
    a: { startIndex: number; endIndex: number },
    ranges: Array<{ startIndex: number; endIndex: number }>,
  ) => ranges.some((b) => a.startIndex < b.endIndex && b.startIndex < a.endIndex);

  const push = (
    match: { value: string; startIndex: number; endIndex: number },
    category: CategoryType,
  ) => {
    detections.push({
      id: generateId(),
      value: match.value,
      category,
      source: 'regex',
      startIndex: match.startIndex,
      endIndex: match.endIndex,
    });
  };

  const d = config.detectors;
  const emailRanges = d.email ? findAllMatches(text, EMAIL_REGEX) : [];
  const phoneRanges = d.phone ? findAllMatches(text, PHONE_REGEX) : [];
  const urlRanges = d.url ? findAllMatches(text, URL_REGEX) : [];
  const ibanRanges = d.iban ? findAllMatches(text, IBAN_REGEX) : [];
  const ccRanges = d.creditCard ? findAllMatches(text, CREDIT_CARD_REGEX) : [];
  const ribRanges = d.iban ? findAllMatches(text, RIB_REGEX) : [];
  const apiKeyRanges = d.apiKey ? findAllMatches(text, API_KEY_REGEX) : [];
  const jwtRanges = d.apiKey ? findAllMatches(text, JWT_REGEX) : [];
  const bearerRanges = d.apiKey ? findAllMatches(text, BEARER_REGEX) : [];
  const passwordRanges = d.password ? findAllMatches(text, PASSWORD_LINE_REGEX) : [];
  const passportRanges = d.passport ? findAllMatches(text, PASSPORT_REGEX) : [];
  const driverRanges = d.driverLicense ? findAllMatches(text, DRIVER_LICENSE_REGEX) : [];
  const nirRanges = d.governmentId ? findAllMatches(text, NIR_REGEX) : [];
  const siretRanges = d.governmentId ? findAllMatches(text, SIRET_REGEX) : [];
  const sirenRanges = d.governmentId ? findAllMatches(text, SIREN_REGEX) : [];
  const vatRanges = d.governmentId ? findAllMatches(text, VAT_REGEX) : [];
  const ssnRanges = d.governmentId ? findAllMatches(text, SSN_US_REGEX) : [];
  const ipv4Ranges = (d.ipAddress ? findAllMatches(text, IPV4_REGEX) : [])
    .filter((m) => !overlapsAny(m, phoneRanges));
  const ipv6Ranges = d.ipAddress ? findAllMatches(text, IPV6_REGEX) : [];
  const macRanges = d.macAddress ? findAllMatches(text, MAC_REGEX) : [];
  const cvvRanges = d.creditCard ? findAllMatches(text, CVV_REGEX) : [];
  const expiryRanges = d.creditCard ? findAllMatches(text, EXPIRY_REGEX) : [];
  const dobRanges = d.date ? findAllMatches(text, DOB_REGEX) : [];
  const addressFrRanges = d.address ? findAllMatches(text, ADDRESS_FR_REGEX) : [];
  const addressEnRanges = d.address ? findAllMatches(text, ADDRESS_EN_REGEX) : [];
  const zipRanges = d.address ? findAllMatches(text, ZIP_US_REGEX) : [];
  const dateFrRanges = d.date ? findAllMatches(text, DATE_FR_REGEX) : [];
  const dateFrLongRanges = d.date ? findAllMatches(text, DATE_FR_LONG_REGEX) : [];
  const dateIsoRanges = d.date ? findAllMatches(text, DATE_ISO_REGEX) : [];
  const dateEnRanges = d.date ? findAllMatches(text, DATE_EN_REGEX) : [];
  const salaryRanges = d.salary ? findAllMatches(text, SALARY_REGEX) : [];
  const priceRanges = d.price ? findAllMatches(text, PRICE_REGEX) : [];

  for (const m of emailRanges) push(m, 'EMAIL');
  for (const m of salaryRanges) push(m, 'SALARY');
  for (const m of dobRanges) push(m, 'DATE');

  for (const m of addressFrRanges) push(m, 'ADDRESS');
  for (const m of addressEnRanges) push(m, 'ADDRESS');
  for (const m of zipRanges) {
    if (overlapsAny(m, addressEnRanges)) continue;
    push(m, 'ADDRESS');
  }

  for (const m of ribRanges) push(m, 'IBAN');
  for (const m of ibanRanges) push(m, 'IBAN');
  for (const m of ccRanges) push(m, 'CARD');
  for (const m of cvvRanges) push(m, 'CARD');
  for (const m of expiryRanges) push(m, 'CARD');

  if (d.iban) {
    const bicMatches = findAllMatches(text, BIC_REGEX);
    for (const m of bicMatches) {
      if (overlapsAny(m, vatRanges)) continue;
      push(m, 'IBAN');
    }
  }

  for (const m of nirRanges) push(m, 'NIR');
  for (const m of siretRanges) push(m, 'SIRET');
  for (const m of sirenRanges) {
    if (overlapsAny(m, siretRanges)) continue;
    push(m, 'GOV_ID');
  }
  for (const m of vatRanges) push(m, 'VAT');
  for (const m of ssnRanges) push(m, 'SSN');
  for (const m of passportRanges) push(m, 'PASSPORT');
  for (const m of driverRanges) push(m, 'LICENSE');

  for (const m of ipv4Ranges) push(m, 'IP');
  for (const m of ipv6Ranges) push(m, 'IP');
  for (const m of macRanges) push(m, 'MAC');

  for (const m of urlRanges) push(m, 'URL');

  if (d.socialHandle) {
    const handleMatches = findAllMatches(text, HANDLE_REGEX).filter(
      (h) => !overlapsAny(h, emailRanges),
    );
    for (const m of handleMatches) push(m, 'HANDLE');
  }

  for (const m of dateFrRanges) {
    if (overlapsAny(m, expiryRanges)) continue;
    push(m, 'DATE');
  }
  for (const m of dateFrLongRanges) {
    if (overlapsAny(m, dobRanges)) continue;
    push(m, 'DATE');
  }
  for (const m of dateIsoRanges) push(m, 'DATE');
  for (const m of dateEnRanges) {
    if (overlapsAny(m, dobRanges)) continue;
    push(m, 'DATE');
  }

  for (const m of apiKeyRanges) push(m, 'API_KEY');
  for (const m of jwtRanges) push(m, 'API_KEY');
  for (const m of bearerRanges) push(m, 'API_KEY');
  for (const m of passwordRanges) push(m, 'PASSWORD');

  if (d.phone) {
    for (const m of phoneRanges) {
      if (overlapsAny(m, ibanRanges) || overlapsAny(m, urlRanges) || overlapsAny(m, priceRanges)) continue;
      push(m, 'PHONE');
    }
  }

  if (d.price) {
    for (const m of priceRanges) {
      if (overlapsAny(m, emailRanges) || overlapsAny(m, ibanRanges) || overlapsAny(m, urlRanges)) continue;
      if (overlapsAny(m, salaryRanges)) continue;
      push(m, 'PRICE');
    }
  }

  if (d.internalCode) {
    const idRegex = createIdRegex(config.idMinLength);
    const idMatches = findAllMatches(text, idRegex);
    const emailValues = new Set(emailRanges.map((m) => m.value));
    for (const m of idMatches) {
      if (emailValues.has(m.value)) continue;
      if (overlapsAny(m, urlRanges) || overlapsAny(m, priceRanges)) continue;
      if (/^\d+$/.test(m.value)) continue;
      push(m, 'ID');
    }
  }

  return detections;
}

export function detectWithNER(text: string, config: AnonymizerConfig): Detection[] {
  const entities = detectEntities(text, {
    persons: config.detectors.person,
    organizations: config.detectors.organization,
  });
  return entities.map((entity) => ({
    id: generateId(),
    value: entity.value,
    category: (entity.type === 'person' ? 'PERSON' : 'COMPANY') as CategoryType,
    source: 'ner' as const,
    startIndex: entity.startIndex,
    endIndex: entity.endIndex,
  }));
}

export function detectWithRules(text: string, rules: Rule[]): Detection[] {
  const detections: Detection[] = [];
  for (const rule of rules) {
    const matches = findTermInText(text, rule.term, rule.caseSensitive ?? false);
    for (const match of matches) {
      detections.push({
        id: generateId(),
        value: match.value,
        category: rule.category,
        source: 'manual',
        startIndex: match.startIndex,
        endIndex: match.endIndex,
      });
    }
  }
  return detections;
}

export function detectSensitive(text: string, config: AnonymizerConfig, rules: Rule[] = []): Detection[] {
  const all = [
    ...detectWithRegex(text, config),
    ...detectWithNER(text, config),
    ...detectWithRules(text, rules),
  ];
  return mergeRanges(all);
}

function generateMapping(
  detections: Detection[],
  placeholderStyle: 'brackets' | 'curly',
): Map<string, MappingEntry> {
  const mapping = new Map<string, MappingEntry>();
  const categoryCounters: Record<string, number> = {};

  for (const detection of detections) {
    const key = detection.value.toLowerCase();
    if (mapping.has(key)) {
      mapping.get(key)!.count++;
    } else {
      const category = detection.category;
      categoryCounters[category] = (categoryCounters[category] || 0) + 1;
      mapping.set(key, {
        id: generateId(),
        original: detection.value,
        placeholder: formatPlaceholder(category, categoryCounters[category], placeholderStyle),
        category: detection.category,
        source: detection.source,
        count: 1,
      });
    }
  }
  return mapping;
}

export function anonymize(
  text: string,
  rules: Rule[],
  config: AnonymizerConfig,
): AnonymizationResult {
  const detections = detectSensitive(text, config, rules);
  const mappingMap = generateMapping(detections, config.placeholderStyle);

  const sortedDetections = sortByPosition(detections).reverse();

  let anonymizedText = text;
  for (const detection of sortedDetections) {
    const key = detection.value.toLowerCase();
    const entry = mappingMap.get(key);
    if (entry) {
      anonymizedText =
        anonymizedText.substring(0, detection.startIndex) +
        entry.placeholder +
        anonymizedText.substring(detection.endIndex);
    }
  }

  return {
    anonymizedText,
    mapping: Array.from(mappingMap.values()),
    detections: sortByPosition(detections),
  };
}

export function deanonymize(text: string, mapping: MappingEntry[]): string {
  let result = text;
  // Sort by placeholder length DESC to avoid prefix collisions
  // (e.g. [PERSON_1] inside [PERSON_10]).
  const sorted = [...mapping].sort((a, b) => b.placeholder.length - a.placeholder.length);
  for (const entry of sorted) {
    const regex = new RegExp(escapeRegexString(entry.placeholder), 'g');
    result = result.replace(regex, entry.original);
  }
  return result;
}

// Concatenate-and-anonymize strategy: lets multiple texts share a single
// mapping so the same value gets the same placeholder across messages.
const SEPARATOR = '\n@@@UMBELI_ANON_SEP@@@\n';

export function anonymizeMany(
  texts: string[],
  rules: Rule[],
  config: AnonymizerConfig,
): { anonymizedTexts: string[]; mapping: MappingEntry[] } {
  if (texts.length === 0) return { anonymizedTexts: [], mapping: [] };
  const combined = texts.join(SEPARATOR);
  const result = anonymize(combined, rules, config);
  const anonymizedTexts = result.anonymizedText.split(SEPARATOR);
  return { anonymizedTexts, mapping: result.mapping };
}
