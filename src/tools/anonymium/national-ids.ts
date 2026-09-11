// Ported verbatim from Anonymum/src/utils/national-ids.ts.
import type { CategoryType } from './types';

// Registre d'identifiants nationaux par pays (i18n Phase 2).
// Les checksums servent à RENFORCER la catégorie / la confiance, pas à filtrer
// une vraie PII (principe : la sur-rédaction est le côté sûr). Pour le SIN, si
// le Luhn échoue on ne tague pas SIN, mais le détecteur générique (SIREN ->
// GOV_ID) couvre quand même la séquence -> aucune fuite.

export interface NationalIdMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

// Somme de Luhn générique (NAS = 9 chiffres, IMEI = 15, cartes = 13-19). La
// longueur attendue est vérifiée par l'appelant. Exportée pour le moteur
// (détection IMEI nu sans mot-clé).
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function luhn(digits: string): boolean {
  return digits.length === 9 && luhnValid(digits);
}

// Espagne DNI/NIE : lettre de contrôle = table[nombre % 23].
function validDni(v: string): boolean {
  const c = v.replace(/[-\s]/g, '').toUpperCase();
  const m = c.match(/^([XYZ]\d{7}|\d{8})([A-Z])$/);
  if (!m) return false;
  const body = m[1].replace(/^X/, '0').replace(/^Y/, '1').replace(/^Z/, '2');
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[parseInt(body, 10) % 23] === m[2];
}

// Canada (3-3-3). Séparateurs {1,2} : un double espace (« 046  454 286 »,
// fréquent dans les tableaux copiés-collés) ne doit pas faire fuir le NAS.
const SIN_RE = /(?<!\d)\d{3}[ -]{1,2}\d{3}[ -]{1,2}\d{3}(?!\d)/g;
// NAS collé (« 046454286 ») : 9 chiffres nus = trop ambigu seuls, on exige
// Luhn valide ET un mot-clé NAS/SIN à proximité (±40 caractères).
const SIN_BARE_RE = /(?<!\d)\d{9}(?!\d)/g;
const SIN_CONTEXT_RE = /\b(?:NAS|SIN|assurance\s+sociale|social\s+insurance)\b/i;
const IT_CF_RE = /\b[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]\b/g; // Italie (codice fiscale)
const ES_DNI_RE = /\b(?:[XYZ]\d{7}|\d{8})-?[A-HJ-NP-TV-Z]\b/g; // Espagne DNI/NIE
const UK_NINO_RE = /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g; // Royaume-Uni NINO

/** Détecte des identifiants nationaux (multi-pays). */
export function detectNationalIds(text: string): NationalIdMatch[] {
  const out: NationalIdMatch[] = [];
  const scan = (re: RegExp, category: CategoryType, validate?: (v: string) => boolean) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!validate || validate(m[0])) {
        out.push({ value: m[0], startIndex: m.index, endIndex: m.index + m[0].length, category });
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };

  scan(SIN_RE, 'SIN', (v) => luhn(v.replace(/\D/g, '')));
  // NAS collé : Luhn + contexte requis.
  SIN_BARE_RE.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = SIN_BARE_RE.exec(text)) !== null) {
    if (luhn(bm[0]) && SIN_CONTEXT_RE.test(text.slice(Math.max(0, bm.index - 40), bm.index + bm[0].length + 40))) {
      out.push({ value: bm[0], startIndex: bm.index, endIndex: bm.index + bm[0].length, category: 'SIN' });
    }
  }
  scan(IT_CF_RE, 'GOV_ID');
  scan(ES_DNI_RE, 'GOV_ID', validDni);
  // NINO britannique : contextualisé (mot-clé requis) pour éviter le bruit sur
  // « 2 lettres + 6 chiffres + lettre ».
  if (/\b(?:national\s+insurance|nino)\b/i.test(text)) scan(UK_NINO_RE, 'GOV_ID');

  return out;
}
