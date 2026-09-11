// Ported verbatim from Anonymum/src/utils/document-coherence.ts.
import type { CategoryType, Detection } from './types';
import { generateId } from './helpers';

// Cohérence documentaire.
//
// Une donnée reconnue à un endroit du document fuit souvent ailleurs sous une
// autre GRAPHIE : « Marc-André Gagnon » devient « MarcAndreGagnon » dans un nom
// de pièce jointe, « Novatek Solutions » devient « NOVATEK SOLUTIONS » sur un
// relevé bancaire, « 85.07.30-033.61 » devient « 85073003361 » dans un export
// CSV, « Youssef El Amrani » devient « Elamrani ». Chacune de ces occurrences
// est la MÊME donnée personnelle : la laisser en clair annule l'anonymisation.
//
// On repart donc des valeurs déjà détectées et on ratisse le texte à la
// recherche de leurs variantes. Le risque de faux positif est faible : la
// valeur est déjà établie comme sensible DANS CE DOCUMENT.

// Catégories dont les variantes graphiques valent la peine d'être rattachées.
// On exclut les catégories dont la valeur est déjà canonique et unique (URL,
// email, IP…) : y chercher des variantes n'apporterait que du bruit.
const ELIGIBLE: ReadonlySet<string> = new Set<CategoryType>([
  'PERSON', 'ORGANIZATION', 'COMPANY', 'BANK_NAME',
  'GOV_ID', 'NIR', 'SIN', 'SSN', 'HEALTH_CARD', 'PASSPORT', 'DRIVER_LICENSE',
  'COMPANY_ID', 'SIREN', 'SIRET', 'VAT', 'BANK_ACCOUNT', 'IBAN',
  'EMPLOYEE_ID', 'STUDENT_CODE', 'LICENSE_PLATE', 'VIN',
]);

// Mots qui, isolés, sont trop courants pour servir de clé de rattachement même
// s'ils apparaissent dans un nom détecté.
const TOO_COMMON: ReadonlySet<string> = new Set([
  'rose', 'pierre', 'blanc', 'france', 'martin', 'louis', 'olivier', 'laurent',
  'jardin', 'mercier', 'boulanger', 'lefebvre', 'fontaine', 'bourget',
  'solutions', 'services', 'groupe', 'banque', 'conseil', 'cabinet', 'agence',
  'atlas', 'bordeaux', 'sud', 'nord', 'est', 'ouest', 'centre',
  'travail', 'emploi', 'sante', 'famille', 'maison', 'immobilier',
]);

const ACCENT_CLASS: Record<string, string> = {
  a: 'aàâäáãå', c: 'cç', e: 'eéèêë', i: 'iîïíì', n: 'nñ',
  o: 'oôöóòõ', u: 'uùûüú', y: 'yÿý',
};

/** Clé de comparaison : sans accents, sans séparateurs, en minuscules. */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Motif tolérant pour une valeur : accents libres et séparateurs optionnels
 * entre les caractères, de sorte que « Marc-André Gagnon », « MARC ANDRE
 * GAGNON » et « MarcAndreGagnon » soient tous reconnus.
 */
function variantPattern(normalized: string): string {
  // Séparateurs admis ENTRE deux caractères. Borné à 2 pour éviter de recoller
  // deux occurrences distinctes séparées par du texte.
  const sep = "[\\s\\-_'’.]{0,2}";
  return normalized
    .split('')
    .map((ch) => (ACCENT_CLASS[ch] ? `[${ACCENT_CLASS[ch]}]` : escapeRe(ch)))
    .join(sep);
}

interface Candidate {
  /** Valeur canonique : c'est elle qui décide du placeholder. */
  canonical: string;
  category: CategoryType;
  pattern: string;
  /**
   * Clé réduite au nom de famille. Beaucoup plus risquée que la clé complète :
   * « France Travail » y produit « travail », qui est un nom commun. Ces clés
   * n'acceptent donc qu'une occurrence CAPITALISÉE.
   */
  surnameOnly?: boolean;
}

function buildCandidates(detections: Detection[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];

  const add = (canonical: string, category: CategoryType, key: string, surnameOnly = false) => {
    if (key.length < 6 && !surnameOnly) return; // trop court : collisions fortuites
    if (TOO_COMMON.has(key)) return;
    const dedupe = `${category}::${key}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ canonical, category, pattern: variantPattern(key), surnameOnly });
  };

  for (const d of detections) {
    if (!ELIGIBLE.has(d.category)) continue;
    const value = d.value.trim();
    if (!value) continue;
    add(value, d.category, normalizeKey(value));

    // Pour une personne, le NOM DE FAMILLE seul reste identifiant : « née
    // Vasseur » et « Me.Delvaux » n'apparaissent jamais sous leur forme
    // complète. On enregistre donc les 1 et 2 derniers jetons.
    if (d.category === 'PERSON') {
      const tokens = value.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        const last = tokens[tokens.length - 1];
        const lastTwo = tokens.slice(-2).join(' ');
        const lastKey = normalizeKey(last);
        if (lastKey.length >= 5 && !TOO_COMMON.has(lastKey)) add(value, d.category, lastKey, true);
        const lastTwoKey = normalizeKey(lastTwo);
        if (lastTwoKey.length >= 6) add(value, d.category, lastTwoKey, true);
      }
    }
  }

  return out;
}

/**
 * Cherche les occurrences non encore couvertes des valeurs déjà détectées.
 * Les détections rendues portent la valeur CANONIQUE : elles reçoivent donc le
 * même placeholder que l'occurrence d'origine, ce qui garde le document lisible
 * et la bijection intacte.
 */
export function findCoherenceDetections(text: string, detections: Detection[]): Detection[] {
  const covered = detections.map((d) => ({ start: d.startIndex, end: d.endIndex }));
  const overlaps = (start: number, end: number) =>
    covered.some((c) => start < c.end && c.start < end);

  const extra: Detection[] = [];

  for (const candidate of buildCandidates(detections)) {
    // Bornes de mot : on ne veut pas rattacher « Amrani » au milieu d'un autre
    // mot, ni un numéro au milieu d'un numéro plus long.
    // Insensible à la casse : c'est précisément la variation qu'on cherche
    // (« Novatek Solutions » -> « NOVATEK SOLUTIONS » sur un relevé bancaire,
    // « Marc-André Gagnon » -> « MarcAndreGagnon » dans un nom de fichier).
    const re = new RegExp(`(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9])(?:${candidate.pattern})(?![A-Za-zÀ-ÖØ-öø-ÿ0-9])`, 'giu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
      if (!m[0].trim()) continue;
      // Une clé réduite au nom de famille ne se rattache qu'à une occurrence
      // CAPITALISÉE : sans cette garde, « France Travail » anonymisait le nom
      // commun « travail » dans « un travail de bureau ».
      if (candidate.surnameOnly && !/^[A-ZÀ-ÖØ-Ý]/.test(m[0])) continue;
      if (overlaps(start, end)) continue;
      // Ne pas empiler deux rattachements sur la même étendue.
      if (extra.some((e) => start < e.endIndex && e.startIndex < end)) continue;
      extra.push({
        id: generateId(),
        value: candidate.canonical,
        category: candidate.category,
        source: 'similarity',
        startIndex: start,
        endIndex: end,
      });
    }
  }

  return extra;
}
