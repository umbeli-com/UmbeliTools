// Ported verbatim from Anonymum/src/utils/maghreb-africa-identifiers.ts.
import { scanLabelledIds, type LabelledIdMatch, type LabelledIdRule } from './labelled-id';

// Pack d'identifiants Maghreb et Afrique francophone (MA, TN, DZ, SN, CI, BJ).
//
// Presque toutes ces valeurs sont des suites de chiffres nues : identifiant
// fiscal marocain à 8 chiffres, CNSS à 9, CIN tunisienne à 8… Les reconnaître à
// la forme reviendrait à anonymiser tous les nombres du document. Chaque règle
// est donc ancrée sur son LIBELLÉ (voir labelled-id.ts).

const RULES: LabelledIdRule[] = [
  // ---- Maroc -----------------------------------------------------------
  {
    // CIN / CNIE : 1 à 2 lettres suivies de 5 à 6 chiffres (« BE789456 »).
    label: 'CIN|CNIE|carte\\s+nationale\\s+d[\'’]?\\s*identit[ée]\\s+marocaine',
    value: '[A-Z]{1,2}\\d{5,6}',
    category: 'GOV_ID',
  },
  {
    label: 'CNSS',
    value: '\\d{7,9}',
    category: 'GOV_ID',
  },
  {
    label: 'AMO|CNOPS',
    value: '\\d{9}',
    category: 'HEALTH_CARD',
  },
  {
    // Permis marocain « 12/345678 ».
    label: 'permis\\s+de\\s+conduire',
    value: '\\d{2}/\\d{6}',
    category: 'DRIVER_LICENSE',
  },
  {
    // ICE : identifiant commun de l'entreprise, 15 chiffres.
    label: 'ICE|identifiant\\s+commun\\s+de\\s+l[\'’]?\\s*entreprise',
    value: '\\d{15}',
    category: 'COMPANY_ID',
  },
  {
    // Identifiant fiscal (8 chiffres) et taxe professionnelle / patente.
    label: 'identifiant\\s+fiscal|\\bIF\\b|taxe\\s+professionnelle|patente',
    value: '\\d{7,9}',
    category: 'COMPANY_ID',
  },
  {
    // RIB marocain : 24 chiffres, écrits en groupes (« 011 519 … 22 »).
    label: 'RIB',
    value: '\\d{3}\\s\\d{3}\\s\\d{16}\\s\\d{2}|\\d{24}',
    category: 'BANK_ACCOUNT',
  },
  {
    // Plaques marocaines translittérées : « 45678-A-12 », « 123456-A-45 ».
    label: 'immatriculation|plaque',
    value: '\\d{4,6}\\s?-\\s?[A-Z]\\s?-\\s?\\d{1,2}',
    category: 'LICENSE_PLATE',
  },

  // ---- Tunisie ---------------------------------------------------------
  {
    label: 'CIN\\s+tunisienne|carte\\s+d[\'’]?\\s*identit[ée]\\s+tunisienne',
    value: '\\d{8}',
    category: 'GOV_ID',
  },
  {
    label: 'matricule\\s+fiscal',
    value: '\\d{7}/[A-Z]/[A-Z]/\\d{3}',
    category: 'COMPANY_ID',
  },

  // ---- Algérie ---------------------------------------------------------
  {
    // NIN algérien : 18 chiffres au plus. À catégorie GOV_ID (priorité 76) il
    // l'emporte sur CREDIT_CARD (70), qui le réclamait à tort quand la somme
    // de Luhn tombait juste par coïncidence.
    label: 'NIN|num[ée]ro\\s+d[\'’]?\\s*identification\\s+nationale',
    value: '\\d{16,18}',
    category: 'GOV_ID',
  },
  {
    label: 'NIF|num[ée]ro\\s+d[\'’]?\\s*identification\\s+fiscale',
    value: '\\d{15}',
    category: 'COMPANY_ID',
  },

  // ---- Sénégal ---------------------------------------------------------
  {
    label: 'carte\\s+nationale\\s+d[\'’]?\\s*identit[ée]',
    value: '\\d{13}',
    category: 'GOV_ID',
  },
  {
    label: 'NINEA',
    value: '\\d{9}\\s?\\d?[A-Z]\\d',
    category: 'COMPANY_ID',
  },

  // ---- Côte d'Ivoire ---------------------------------------------------
  {
    label: 'carte\\s+nationale\\s+d[\'’]?\\s*identit[ée]',
    value: 'CI\\d{10}',
    category: 'GOV_ID',
  },
  {
    label: 'compte\\s+contribuable',
    value: '\\d{7}\\s?[A-Z]',
    category: 'COMPANY_ID',
  },

  // ---- Bénin -----------------------------------------------------------
  {
    label: 'NPI|num[ée]ro\\s+personnel\\s+d[\'’]?\\s*identification',
    value: '\\d{10}',
    category: 'GOV_ID',
  },
  {
    label: 'IFU|identifiant\\s+fiscal\\s+unique',
    value: '\\d{13}',
    category: 'COMPANY_ID',
  },

  // ---- Registres du commerce (formes nationales) ------------------------
  {
    // « SN DKR 2019 B 12345 », « CI-ABJ-2019-B-12345 », « RB/COT/20 A 12345 ».
    label: 'registre\\s+du\\s+commerce|\\bRCCM\\b',
    value: '[A-Z]{2}[\\s-][A-Z]{3}[\\s-]\\d{2,4}[\\s-][A-Z][\\s-]\\d{4,6}|RB/[A-Z]{3}/\\d{2}\\s[A-Z]\\s\\d{4,6}',
    category: 'COMPANY_ID',
  },
];

// Registre de commerce marocain : « Casablanca 456789 » en ligne de formulaire,
// mais aussi « immatriculée au registre du commerce de Casablanca sous le
// numéro 456789 » en prose, et « sous le RC 456789 à Casablanca ». Les trois
// écritures désignent le même identifiant, d'où un motif dédié plutôt qu'une
// règle libellée générique.
const MA_RC =
  // « RC » ne doit PAS accrocher le « RCS » français (registre du commerce et
  // des sociétés) : « Immatriculée au RCS de Lyon sous le numéro 552100554 »
  // est un SIREN, pas un registre marocain.
  /(?:registre\s+(?:de|du)\s+commerce(?:\s*\(RC\))?|\bRC(?!S)\b)[^.\n]{0,60}?[:=]?\s*((?:[A-ZÀ-Ý][a-zà-ÿ]+\s+)?\d{5,9})\b/gi;

export function detectMaghrebAfricaIdentifiers(text: string): LabelledIdMatch[] {
  const out = scanLabelledIds(text, RULES);

  MA_RC.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MA_RC.exec(text)) !== null) {
    const value = m[1];
    if (value) {
      const at = m.index + m[0].lastIndexOf(value);
      out.push({ value, startIndex: at, endIndex: at + value.length, category: 'COMPANY_ID' });
    }
    if (m.index === MA_RC.lastIndex) MA_RC.lastIndex++;
  }

  return out;
}
