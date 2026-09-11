// Ported verbatim from Anonymum/src/utils/be-ch-lu-identifiers.ts.
import { scanLabelledIds, type LabelledIdMatch, type LabelledIdRule } from './labelled-id';

// Pack d'identifiants Belgique / Suisse / Luxembourg.
//
// Toutes les règles sont ancrées sur leur LIBELLÉ (voir labelled-id.ts) : les
// valeurs sont des suites de chiffres trop banales pour être reconnues à la
// forme seule. Deux exceptions assumées, dont la forme est intrinsèquement
// distinctive : le numéro d'entreprise suisse (préfixe « CHE- ») et le registre
// du commerce suisse (préfixe « CH- »).

const RULES: LabelledIdRule[] = [
  // ---- Belgique --------------------------------------------------------
  {
    // « 85.07.30-033.61 » (pointé) et « 85073003361 » (compact). Les deux
    // écritures cohabitent dans un même dossier.
    label: 'registre\\s+national|rijksregister|n(?:um[ée]ro)?\\s*RN',
    value: '\\d{2}\\.\\d{2}\\.\\d{2}-\\d{3}\\.\\d{2}|\\d{11}',
    category: 'GOV_ID',
  },
  {
    label: 'mutualit[ée]|mutuelle\\s+belge',
    value: '\\d{3}/\\d{7}/\\d{2}',
    category: 'HEALTH_CARD',
  },
  {
    label: 'unit[ée]\\s+d[\'’]?\\s*[ée]tablissement',
    value: '\\d\\.\\d{3}\\.\\d{3}\\.\\d{3}',
    category: 'COMPANY_ID',
  },
  {
    // Plaque belge actuelle : « 1-ABC-123 ». Sans cette règle, seul
    // « ABC-123 » était capté et le « 1- » restait en clair.
    label: 'immatriculation|plaque',
    value: '\\d-[A-Z]{3}-\\d{3}',
    category: 'LICENSE_PLATE',
  },

  // ---- Suisse ----------------------------------------------------------
  {
    // AVS à 13 chiffres : « 756.1234.5678.97 ».
    label: 'AVS|AHV|assurance[- ]vieillesse',
    value: '756\\.\\d{4}\\.\\d{4}\\.\\d{2}|756\\d{10}',
    category: 'GOV_ID',
  },
  {
    // Numéro d'assuré figurant sur la carte maladie : 20 chiffres.
    label: 'carte\\s+maladie|assur[ée]\\s+carte|num[ée]ro\\s+d[\'’]?\\s*assur[ée]',
    value: '\\d{20}',
    category: 'HEALTH_CARD',
  },
  {
    label: 'passeport\\s+suisse',
    value: '[A-Z]\\d{7}',
    category: 'PASSPORT',
  },
  {
    // « 2019 1234567 8 » — année + numéro + clé.
    label: 'permis\\s+de\\s+conduire',
    value: '\\d{4}\\s\\d{7}\\s\\d',
    category: 'DRIVER_LICENSE',
  },
  {
    label: 'caisse\\s+de\\s+compensation|affiliation',
    value: '\\d{3}\\.\\d{5}',
    category: 'COMPANY_ID',
  },
  {
    // Plaques cantonales « GE 123456 » / « VD 456789 ». Gardées derrière le
    // libellé : deux capitales + six chiffres est une forme trop courante.
    label: 'immatriculation|plaque',
    value: '(?:AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)\\s\\d{3,6}',
    category: 'LICENSE_PLATE',
  },

  {
    // Formats nationaux belge (« 02 511 22 33 ») et suisse (« 021 613 44 55 »).
    // Le détecteur de téléphone est réglé sur une seule région à la fois : sans
    // cette règle, un numéro national étranger reste en clair dans un document
    // multi-juridictions.
    label: 't[ée]l[ée]phone(?:\\s+fixe)?|mobile|fax|gsm|natel',
    value: '0\\d{1,2}\\s\\d{3}\\s\\d{2}\\s\\d{2}',
    category: 'PHONE',
  },

  // ---- Luxembourg ------------------------------------------------------
  {
    // Matricule national : 13 chiffres groupés « 1985 07 30 123 45 ».
    label: 'matricule\\s+national',
    value: '\\d{4}\\s\\d{2}\\s\\d{2}\\s\\d{3}\\s\\d{2}|\\d{13}',
    category: 'GOV_ID',
  },
  {
    // RCS luxembourgeois : lettre de section + numéro (« B 234567 »).
    label: 'RCS',
    value: '[A-Z]\\s?\\d{4,6}',
    category: 'COMPANY_ID',
  },
];

// Numéro d'entreprise suisse (IDE / UID / n° de TVA). Le préfixe « CHE » rend
// la forme non ambiguë, donc pas besoin de libellé. Sans cette règle, « CHE- »
// partait en PERSON et « 123.456.789 » restait EN CLAIR dans la sortie.
const CHE_UID = /\bCHE-?\d{3}\.\d{3}\.\d{3}(?:\s?(?:TVA|MWST|IVA))?\b/g;

// Registre du commerce suisse : « CH-660.1.234.567-8 ».
const CH_RC = /\bCH-\d{3}\.\d\.\d{3}\.\d{3}-\d\b/g;

// Date pointée à la suisse : « 22.11.1978 ». Le format jour.mois.année à quatre
// chiffres ne peut pas être confondu avec un numéro de version (« 4.2.1 ») ni
// avec un identifiant pointé (« 106.83452 »).
const CH_DOTTED_DATE = /\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:19|20)\d{2}\b/g;

export function detectBeChLuIdentifiers(text: string): LabelledIdMatch[] {
  const out = scanLabelledIds(text, RULES);

  const scan = (re: RegExp, category: LabelledIdMatch['category']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ value: m[0], startIndex: m.index, endIndex: m.index + m[0].length, category });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };

  scan(CHE_UID, 'COMPANY_ID');
  scan(CH_RC, 'COMPANY_ID');
  scan(CH_DOTTED_DATE, 'DATE');

  return out;
}
