// Ported verbatim from Anonymum/src/utils/fr-address.ts.
import type { CategoryType } from './types';

// Adresses FRANÇAISES.
//
// Une adresse française s'écrit rarement d'un bloc : la voie et le « code postal
// + ville » sont séparés par une virgule, un retour à la ligne… ou rien du tout.
// Une seule méga-regex rate systématiquement l'une de ces variantes (c'était le
// cas : « 12 rue de la Paix 75002 Paris » sans virgule fuyait à moitié).
//
// On détecte donc les BLOCS séparément — voie, lieu-dit, boîte postale, code
// postal + ville — puis on FUSIONNE ceux qui se suivent. Chaque bloc reste
// anonymisé même s'il apparaît seul : « 61200 Argentan » ou « 2900 boul. des
// Forges » n'ont pas besoin du reste de l'adresse pour être identifiants.

export interface FrAddressMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

// ---- Briques -------------------------------------------------------------

// Types de voie, formes longues ET abréviations postales officielles.
const WAY = [
  'rue', 'r\\.', 'avenue', 'av\\.?', 'ave\\.?', 'boulevard', 'boul\\.?', 'bd\\.?', 'bld\\.?', 'blvd\\.?',
  'chemin', 'ch\\.?', 'impasse', 'imp\\.?', 'place', 'pl\\.?', 'all[ée]es?', 'all\\.?', 'route', 'rte\\.?',
  'quai', 'cours', 'square', 'sq\\.?', 'villa', 'passage', 'pass\\.?', 'sentier', 'ruelle',
  'faubourg', 'fbg\\.?', 'esplanade', 'parvis', 'rond[- ]point', 'voie', 'traverse', 'mail',
  'promenade', 'corniche', 'mont[ée]e', 'c[ôo]te', 'chauss[ée]e', 'galerie', 'carrefour',
  'grande[- ]rue', 'petite[- ]rue', 'grand[- ]place', 'ancienne[- ]route', 'terrasse', 'croissant',
  'digue', 'port', 'per[ée]e', 'venelle', 'placette', 'rampe', 'quartier',
].join('|');

// Un mot de nom de voie : lettres accentuées, chiffres (« rue du 8 Mai 1945 »),
// apostrophes et traits d'union. Jamais un code postal (bloqué en tête).
const NOT_POSTAL = `(?!\\d{5}(?!\\d))`;
const WORD = `${NOT_POSTAL}[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*`;
// Après le premier mot, on n'accepte QUE des connecteurs (de, du, la…) ou des
// mots capitalisés / numériques. Sans cette règle, « 12 rue de la Paix est notre
// siège » avalait la fin de phrase.
const CONNECTOR = `(?:de[ \\t]+la|de[ \\t]+l['’]|de|du|des|d['’]|le|la|les|l['’]|au|aux|et|sur|sous|en|l[èe]s|sainte?|st[e]?\\.?)`;
const CAP_WORD = `${NOT_POSTAL}[A-ZÀ-ÖØ-Ý0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*`;
const NAME = `${WORD}(?:[ \\t]+(?:${CONNECTOR}|${CAP_WORD})){0,6}`;

// Compléments d'adresse (bâtiment, étage, appartement, boîte postale…).
const COMPLEMENT =
  `(?:[ \\t]*,[ \\t]*|[ \\t]+)(?:` +
  `b[âa]t(?:iment)?\\.?[ \\t]*[A-Z0-9]{1,3}` +
  `|\\d{1,2}[ \\t]*(?:[eè]me|[eè]r?e?)?[ \\t]*[ée]tage` +
  `|[ée]tage[ \\t]*\\d{1,2}` +
  `|(?:appartement|appart|appt|apt|app)\\.?[ \\t]*(?:n[o°]\\.?[ \\t]*|#[ \\t]*)?\\d{1,4}[A-Za-z]?` +
  `|(?:escalier|esc)\\.?[ \\t]*[A-Z0-9]{1,3}` +
  `|(?:bureau|bur|suite|porte|local|lot)\\.?[ \\t]*(?:n[o°]\\.?[ \\t]*)?\\d{1,4}[A-Za-z]?` +
  `|(?:BP|B\\.P\\.|CS|TSA)[ \\t]*\\d{1,5}` +
  `|chez[ \\t]+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[ \\t]+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)?` +
  `)`;

// Numéro dans la voie : « 12 », « 14 bis », « 3 ter », « 25B ».
const HOUSE_NUMBER = `\\d{1,4}[ \\t]*(?:bis|ter|quater|quinquies|[A-D](?![A-Za-z]))?`;
// `(?![a-zà-öø-ÿ])` derrière le type de voie : sans lui, « 3 places libres » ou
// « 5 routes possibles » passaient pour des adresses (place/route + mot suivant).
const STREET_RE = new RegExp(
  `(?<![\\d/-])${HOUSE_NUMBER}[ \\t]*,?[ \\t]*(?:${WAY})(?![a-zà-öø-ÿ])(?:[ \\t]+${NAME})?(?:${COMPLEMENT}){0,4}`,
  'gi',
);

// Voie SANS numéro : lieu-dit, résidence, zone d'activité… (fréquent en zone
// rurale et en périphérie). Le nom doit ici être un NOM PROPRE (capitale, à
// l'exception d'un connecteur de tête) : sans cette contrainte, « sa résidence
// principale » ou « le quartier calme » passeraient pour des adresses.
// Pas de flag `i` (les mots-clés portent leur propre alternance de casse) :
// sous `i`, `[A-Z]` matcherait aussi les minuscules et la contrainte « nom
// propre » tomberait.
const PLACE_NAME = `(?:${CONNECTOR}[ \\t]+)?${CAP_WORD}(?:[ \\t]+(?:${CONNECTOR}|${CAP_WORD})){0,5}`;
const PLACE_RE = new RegExp(
  `\\b(?:[Ll]ieu[- ]?[Dd]it|[Hh]ameau|[Rr][ÉéEe]sidence|[Rr][ée]s\\.|[Qq]uartier|[Ll]otissement|` +
  `[Dd]omaine|[Cc]los|[Cc]it[ée]|[Zz]one[ \\t]+(?:artisanale|industrielle|commerciale|d['’]activit[ée]s?)|` +
  `Z\\.?A\\.?C?\\.?|Z\\.?I\\.?)` +
  `(?![a-zà-öø-ÿ])[ \\t]+${PLACE_NAME}(?:${COMPLEMENT}){0,4}`,
  'g',
);

// Boîte postale seule (« BP 45 », « CS 70001 ») — n'est émise que soudée à un
// code postal : « CS » isolé est trop ambigu (acronyme courant).
const BOX_RE = /\b(?:BP|B\.P\.|CS|TSA)[ \t]*\d{1,5}\b/g;

// Code postal français (01000–98999, jamais 00xxx) + commune. Le préfixe « F- »
// est la forme internationale. « CEDEX [n] » fait partie de l'adresse.
// Les mots de signature / libellés de champ sont exclus de la continuation :
// sinon « 69002 Lyon\nCordialement » (même ligne) avalait la formule de politesse.
const CITY_STOP = `(?!(?:Cordialement|Bien|Merci|Bonjour|Madame|Monsieur|T[ée]l|Tel|Email|Mail|Fax|Adresse|Objet|SIRET|SIREN|TVA|RCS|NAF|APE)\\b)`;
const CITY = `[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]*(?:[ \\t]+(?:CEDEX|Cedex|cedex|\\d{1,2}|${CITY_STOP}[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]*)){0,3}`;
const POSTAL_CITY_RE = new RegExp(`(?<![\\d.-])(?:F[- ])?(?:0[1-9]|[1-9]\\d)\\d{3}[ \\t]+${CITY}`, 'g');

// Code postal étiqueté, sans commune (« Code postal : 75002 », « CP 75002 »).
const POSTAL_LABELLED_RE =
  /\b(?:code\s+postal|cp|c\.p\.)\s*[:=]?\s*((?:0[1-9]|[1-9]\d)\d{3})(?!\d)/gi;

// ---- Assemblage ----------------------------------------------------------

interface Part {
  start: number;
  end: number;
  kind: 'street' | 'box' | 'postal';
}

function collect(text: string, re: RegExp, kind: Part['kind'], into: Part[]): void {
  const rx = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    // On retire une ponctuation finale avalée par les quantificateurs.
    const value = m[0].replace(/[\s,;.]+$/, '');
    if (value) into.push({ start: m.index, end: m.index + value.length, kind });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
}

/** Le texte entre deux blocs est-il un simple séparateur d'adresse ? */
const JOINABLE = /^[ \t]*[,;–-]?[ \t]*\n?[ \t]*(?:,[ \t]*)?$/;

/**
 * Détecte les adresses françaises (voie, lieu-dit, code postal + commune) et
 * fusionne les blocs contigus en une seule plage.
 */
export function detectFrenchAddresses(text: string): FrAddressMatch[] {
  const parts: Part[] = [];
  collect(text, STREET_RE, 'street', parts);
  collect(text, PLACE_RE, 'street', parts);
  collect(text, BOX_RE, 'box', parts);
  collect(text, POSTAL_CITY_RE, 'postal', parts);

  // Dédoublonnage : à position de départ égale, on garde le bloc le plus long.
  parts.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - a.end));
  const kept: Part[] = [];
  for (const p of parts) {
    const last = kept[kept.length - 1];
    if (last && p.start < last.end) {
      if (p.end > last.end && p.kind === last.kind) last.end = p.end;
      continue;
    }
    kept.push({ ...p });
  }

  // Fusion des blocs séparés uniquement par une virgule / un retour à la ligne.
  const merged: Part[] = [];
  for (const p of kept) {
    const last = merged[merged.length - 1];
    if (last && JOINABLE.test(text.slice(last.end, p.start))) {
      // On ne recolle que dans le sens naturel : voie/BP -> code postal.
      if (last.kind !== 'postal' && (p.kind === 'postal' || p.kind === 'street')) {
        last.end = p.end;
        last.kind = p.kind;
        continue;
      }
    }
    merged.push({ ...p });
  }

  const out: FrAddressMatch[] = merged
    // Une boîte postale restée seule n'est pas assez discriminante.
    .filter((p) => p.kind !== 'box')
    .map((p) => ({
      value: text.slice(p.start, p.end),
      startIndex: p.start,
      endIndex: p.end,
      category: 'ADDRESS' as CategoryType,
    }));

  // Code postal étiqueté sans commune : on n'anonymise que la valeur.
  const rx = new RegExp(POSTAL_LABELLED_RE.source, POSTAL_LABELLED_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const at = m.index + m[0].lastIndexOf(m[1]);
    if (!out.some((o) => at < o.endIndex && o.startIndex < at + m![1].length)) {
      out.push({ value: m[1], startIndex: at, endIndex: at + m[1].length, category: 'POSTAL_CODE' });
    }
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }

  return out;
}
