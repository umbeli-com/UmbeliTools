// Ported verbatim from Anonymium/src/utils/regex.ts — these patterns are
// the contract between the two services.

export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const PHONE_REGEX = /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}|\+\d{1,3}[\s.()-]{0,4}\d{1,4}(?:[\s.()-]{0,4}\d{1,4}){2,4}/g;
export const PRICE_REGEX = /\b(?:EUR|USD|CAD|GBP|CHF)\s?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?(?!\w)|(?:€|\$|£)\s?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?(?!\w)|(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?\s?(?:€|\$|£|EUR|USD|CAD|GBP|CHF)(?!\w)|\$\s?\d+(?:\.\d+)?[kKmMbB](?!\w)/g;
export const IBAN_REGEX = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
export const BIC_REGEX = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;
export const URL_REGEX = /https?:\/\/[^\s)]+/g;
export const HANDLE_REGEX = /@[a-zA-Z0-9._-]{2,}/g;
export const DATE_FR_REGEX = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
export const DATE_FR_LONG_REGEX = /\b\d{1,2}(?:er|e|ème)?\s+(?:janvier|f[ée]vrier|fevrier|mars|avril|mai|juin|juillet|ao[ûu]t|aout|septembre|octobre|novembre|d[ée]cembre|decembre)\s+\d{2,4}\b/gi;
export const DATE_ISO_REGEX = /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;
export const DATE_EN_REGEX = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/gi;
export const DOB_REGEX = /\b(?:born|n[ée]e?\s+le)\s+(?:\d{1,2}\s+(?:janvier|f[ée]vrier|fevrier|mars|avril|mai|juin|juillet|ao[ûu]t|aout|septembre|octobre|novembre|d[ée]cembre|decembre)\s+\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4})\b/gi;
export const ADDRESS_FR_REGEX = /\b\d{1,4}\s+(?:(?:bis|ter)\s+)?(?:rue|avenue|av\.|boulevard|bd|chemin|impasse|place|all[ée]e|route)\s+[^\n,]+,\s*\d{5}\s+[A-Za-zÀ-ÖØ-öø-ÿ' -]+\b/gi;
export const ADDRESS_EN_REGEX = /\b\d{1,5}[A-Z]?\s+(?:[A-Z][a-zA-Z]+\s+){1,4}(?:Avenue|Ave|Street|St|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Plaza|Place|Pl|Court|Ct|Square|Sq|Highway|Hwy)\.?,\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}(?:,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?\b/g;
export const ZIP_US_REGEX = /\bZIP(?:code)?\s+\d{5}(?:-\d{4})?\b/gi;
export const CREDIT_CARD_REGEX = /\b(?:4\d{3}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|5[1-5]\d{2}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|6(?:011|5\d{2}|22\d)[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|3[47]\d{2}[ -]?\d{6}[ -]?\d{5}|(?:\d{4}[ -]){3}\d{4})\b/g;
export const CVV_REGEX = /\b(?:CVV|CVC|CV2|CCV)\s*:?\s*\d{3,4}\b/gi;
export const EXPIRY_REGEX = /\b(?:exp(?:iry|ires?)?|expiration)\s*:?\s*(?:0[1-9]|1[0-2])[/-](?:\d{2}|\d{4})\b/gi;
export const RIB_REGEX = /\bBanque\s*:\s*\d{5}\s*,\s*Guichet\s*:\s*\d{5}\s*,\s*Compte\s*:\s*\d{8,11}\s*,\s*Cl[eé]\s*:\s*\d{2}\b/gi;
export const NIR_REGEX = /\b[12]\s\d{2}\s(?:0[1-9]|1[0-2])\s(?:\d{2}|2[AB])\s\d{3}\s\d{3}\s\d{2}\b/g;
export const SIRET_REGEX = /\b\d{3}\s\d{3}\s\d{3}\s\d{5}\b/g;
export const SIREN_REGEX = /\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/g;
export const VAT_REGEX = /\b(?:AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|GR|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|GB)\s?\d{2,3}\s?\d{6,12}\b/gi;
export const SSN_US_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

const ID_QUALIFIER = `(?:\\s+(?:britannique|am[eé]ricain(?:e)?|fran[çc]ais(?:e)?|allemand(?:e)?|italien(?:ne)?|espagnol(?:e)?|europ[eé]en(?:ne)?|canadien(?:ne)?|US|UK|FR|DE|IT|ES|EU|CA|number|num[eé]ro|n[°ºo]\\.?|de\\s+conduire|est\\s+le|est\\s+la|est|le|la))*`;

export const PASSPORT_REGEX = new RegExp(
  `\\b(?:passport|passeport)${ID_QUALIFIER}\\s*:?\\s*(?=[A-Z0-9-]*\\d)[A-Z0-9](?:[A-Z0-9-]{4,18}[A-Z0-9])?\\b`,
  'gi',
);

export const DRIVER_LICENSE_REGEX = new RegExp(
  `\\b(?:permis|driver'?s?\\s+licen[cs]e|DL)${ID_QUALIFIER}\\s*:?\\s*(?=[A-Z0-9-]*\\d)[A-Z0-9](?:[A-Z0-9-]{4,20}[A-Z0-9])?\\b`,
  'gi',
);

export const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\b/g;
export const IPV6_REGEX = /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g;
export const MAC_REGEX = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
export const API_KEY_REGEX = /\b(?:sk-ant-(?:api\d+-)?[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[opsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g;
export const JWT_REGEX = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
export const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9_.\-+/=]{8,}\b/g;
export const PASSWORD_LINE_REGEX = /\b(?:password|passwd|pwd|mot\s+de\s+passe|mdp)\s*[:=]\s*\S+/gi;
export const SALARY_REGEX = /\b(?:gagne|touche|per[çc]oit|earns?|makes?|paid)\s+(?:[^\n.,;]*?)(?:\d[\d\s.,]*\s*(?:€|EUR|USD|CAD|GBP|CHF|\$|£)|\$\s?\d+[kKmM]?|\d+[kKmM]\b)(?:\s+(?:par\s+an|annually|per\s+year|\/an|\/year))?/gi;

export function createIdRegex(minLength: number): RegExp {
  const patterns = [
    `(?=[A-Z0-9-_]{6,})(?=[A-Z0-9-_]*[0-9])[A-Z][A-Z0-9]*[-_][A-Z0-9]+(?:[-_][A-Z0-9]+)*`,
    `(?=[A-Z]*[0-9])(?=[0-9]*[A-Z])[A-Z0-9]{${minLength},}`,
  ];
  return new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'gi');
}

export function findAllMatches(
  text: string,
  regex: RegExp,
): Array<{ value: string; startIndex: number; endIndex: number }> {
  const matches: Array<{ value: string; startIndex: number; endIndex: number }> = [];
  const flags = 'g' + (regex.ignoreCase ? 'i' : '');
  const globalRegex = new RegExp(regex.source, flags);
  let match;
  while ((match = globalRegex.exec(text)) !== null) {
    matches.push({ value: match[0], startIndex: match.index, endIndex: match.index + match[0].length });
    if (match.index === globalRegex.lastIndex) globalRegex.lastIndex++;
  }
  return matches;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findTermInText(
  text: string,
  term: string,
  caseSensitive = false,
): Array<{ value: string; startIndex: number; endIndex: number }> {
  const escapedTerm = escapeRegex(term);
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(`\\b${escapedTerm}\\b`, flags);
  return findAllMatches(text, regex);
}
