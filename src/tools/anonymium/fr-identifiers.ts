// Ported verbatim from Anonymum/src/utils/fr-identifiers.ts.
import type { CategoryType } from './types';
import { luhnValid } from './national-ids';

// Identifiants d'entreprise et administratifs FRANÇAIS.
//
// Principe (identique au reste du moteur) : le LIBELLÉ prime sur la forme brute.
// Un numéro étiqueté (« SIRET : … ») est toujours anonymisé, checksum valide ou
// non — un document réel contient des coquilles et la sur-rédaction est le côté
// sûr. À l'inverse, un nombre NU (sans libellé) n'est retenu que s'il valide sa
// clé de contrôle (Luhn) : sans ça, tout nombre de 9 ou 14 chiffres serait pris
// pour un SIREN/SIRET.

export interface FrIdMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

/** Contexte lexical « entreprise française » — requis pour les formes nues. */
const FR_BUSINESS_CTX =
  /(?:SIREN|SIRET|R\.?C\.?S\.?|K-?bis|greffe|immatricul|registre|soci[ée]t[ée]|entreprise|[ée]tablissement|SARL|SASU?|SCI|EURL|SNC|SCOP|auto-?entrepreneur|micro-?entreprise|si[èe]ge\s+social|capital\s+social|TVA|URSSAF|employeur)/i;

/** Chiffres seuls d'une chaîne (« 552 100 554 » -> « 552100554 »). */
const digitsOf = (s: string) => s.replace(/\D/g, '');

/**
 * Clé de contrôle SIREN (9 chiffres) / SIRET (14 chiffres) = Luhn.
 * Exception historique : La Poste (SIREN 356000000) échoue Luhn ; ses numéros
 * sont valides si la somme des chiffres est un multiple de 5.
 */
export function validSirenOrSiret(digits: string): boolean {
  if (digits.length !== 9 && digits.length !== 14) return false;
  if (luhnValid(digits)) return true;
  if (!digits.startsWith('356000000')) return false;
  const sum = digits.split('').reduce((acc, c) => acc + (c.charCodeAt(0) - 48), 0);
  return sum % 5 === 0;
}

/**
 * Clé de TVA intracommunautaire française : clé = (12 + 3 × (SIREN mod 97)) mod 97.
 * Certaines clés sont alphanumériques (anciennes attributions) — dans ce cas on
 * ne peut pas vérifier, on accepte (la forme FR + 2 caractères + 9 chiffres est
 * déjà très spécifique).
 */
export function validFrenchVat(key: string, siren: string): boolean {
  if (!/^\d{2}$/.test(key)) return true;
  return parseInt(key, 10) === (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
}

// ---- Formes ÉTIQUETÉES (libellé à gauche, valeur en groupe 1) --------------
// `[^\n\d]{0,N}` : on saute le « : », « n° », « FR », les espaces… mais jamais
// une fin de ligne (le numéro doit rester sur la ligne du libellé).

// SIRET / SIREN, séparateurs libres (espace, point, tiret, insécable).
const SIRET_LABEL_RE =
  /\b(?:SIRET|S\.I\.R\.E\.T\.?|num[ée]ro\s+SIRET|n[o°]\.?\s*SIRET)\b[^\n\d]{0,20}(\d[\d \t\u00a0\u202f.-]{11,22}\d)(?!\d)/gi;
const SIREN_LABEL_RE =
  /\b(?:SIREN|S\.I\.R\.E\.N\.?|num[ée]ro\s+SIREN|num[ée]ro\s+d['’]entreprise|num[ée]ro\s+d['’]identification)\b[^\n\d]{0,20}(\d[\d \t\u00a0\u202f.-]{6,22}\d)(?!\d)/gi;
// RCS : le numéro d'immatriculation au RCS EST le SIREN. Le libellé est suivi de
// la ville du greffe et parfois d'une lettre (A/B/C/D) : on tolère ~45 caractères
// non chiffrés avant la valeur (« RCS de Lyon sous le numéro … »).
const RCS_LABEL_RE = /\bR\.?C\.?S\.?\b[^\n\d]{0,45}?(\d[\d \t\u00a0\u202f.-]{6,16}\d)(?!\d)/gi;

// NIC : les 5 chiffres d'établissement qui complètent le SIREN.
const NIC_LABEL_RE = /\bNIC\b[^\n\d]{0,15}(\d{5})(?!\d)/gi;
// Numéro de gestion au greffe : « 2019 B 12345 ».
const GESTION_LABEL_RE =
  /\b(?:num[ée]ro\s+de\s+gestion|n[o°]\.?\s*de\s+gestion)\b[^\n\d]{0,15}(\d{4}\s?[A-Z]\s?\d{3,6})(?![\dA-Z])/gi;
// URSSAF / numéro de cotisant employeur (18 chiffres, souvent groupés).
const URSSAF_LABEL_RE =
  /\b(?:URSSAF|num[ée]ro\s+de\s+cotisant|compte\s+cotisant|num[ée]ro\s+employeur)\b[^\n\d]{0,25}(\d[\d \t\u00a0\u202f.-]{10,26}\d)(?!\d)/gi;
// ORIAS (intermédiaires en assurance / banque) : 8 chiffres.
const ORIAS_LABEL_RE = /\b(?:ORIAS|IOBSP)\b[^\n\d]{0,20}(\d{8})(?!\d)/gi;
// Code APE / NAF : « 6201Z », « 62.01Z ».
const APE_LABEL_RE = /\b(?:code\s+)?(?:APE|NAF)\b[^\n\dA-Z]{0,12}(\d{2}\.?\d{2}\s?[A-Z])(?![A-Za-z0-9])/gi;
// EORI français : FR + SIRET.
const EORI_LABEL_RE = /\bEORI\b[^\n]{0,15}?\b(FR\s?\d[\d \t\u00a0\u202f.-]{7,18}\d)(?!\d)/gi;
// Répertoire des métiers (artisans) : SIREN + « RM » + code département.
const RM_LABEL_RE = /\b(?:R\.?M\.?|r[ée]pertoire\s+des\s+m[ée]tiers)\s*[:.]?\s*(\d{9}\s?RM\s?\d{2,3})\b/gi;

// ---- Formes NUES (aucun libellé — checksum ou structure très spécifique) ---

// SIRET nu : 14 chiffres, séparateurs optionnels. Retenu si Luhn valide.
const SIRET_BARE_RE = /(?<!\d)\d{3}[ \t\u00a0\u202f.-]?\d{3}[ \t\u00a0\u202f.-]?\d{3}[ \t\u00a0\u202f.-]?\d{5}(?!\d)/g;
// SIREN nu : 9 chiffres. Retenu si Luhn valide ET contexte entreprise proche.
const SIREN_BARE_RE = /(?<!\d)\d{3}[ \t\u00a0\u202f.-]?\d{3}[ \t\u00a0\u202f.-]?\d{3}(?!\d)/g;
// TVA intracommunautaire française : FR + clé (2 caractères, parfois alphanum) + SIREN.
const VAT_FR_RE = /\bFR[ \t\u00a0\u202f.-]?([0-9A-Z]{2})[ \t\u00a0\u202f.-]?(\d{3}[ \t\u00a0\u202f.-]?\d{3}[ \t\u00a0\u202f.-]?\d{3})(?![0-9A-Z])/g;
// RNA (registre national des associations) : W + 9 caractères (Corse : 2A/2B).
const RNA_BARE_RE = /\b(W(?:\d{2}|2[AB])\d{7})\b/g;
// RIB français nu : banque(5) guichet(5) compte(11 alphanum) clé(2) = 23 caractères.
const RIB_BARE_RE = /(?<![0-9A-Z])\d{5}[ \t\u00a0\u202f.-]?\d{5}[ \t\u00a0\u202f.-]?[0-9A-Z]{11}[ \t\u00a0\u202f.-]?\d{2}(?![0-9A-Z])/g;

/** Une plage de texte contient-elle un mot-clé « entreprise » à ±radius ? */
function hasBusinessContext(text: string, start: number, end: number, radius = 90): boolean {
  return FR_BUSINESS_CTX.test(text.slice(Math.max(0, start - radius), end + radius));
}

/**
 * Détecte les identifiants d'entreprise / administratifs français.
 * Les plages retournées ne couvrent QUE la valeur : le libellé (« SIRET : »)
 * reste lisible dans le texte anonymisé.
 */
export function detectFrenchBusinessIds(text: string): FrIdMatch[] {
  const out: FrIdMatch[] = [];

  const pushValue = (
    whole: string,
    wholeIndex: number,
    value: string,
    category: CategoryType,
  ) => {
    const at = wholeIndex + whole.lastIndexOf(value);
    if (at < wholeIndex) return;
    out.push({ value, startIndex: at, endIndex: at + value.length, category });
  };

  /** Scanne une regex étiquetée et pousse le groupe 1 (la valeur). */
  const scanLabelled = (
    re: RegExp,
    resolve: (value: string) => CategoryType | null,
  ) => {
    const rx = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const raw = m[1]?.trim().replace(/[ \t\u00a0\u202f.-]+$/, '');
      if (raw) {
        const category = resolve(raw);
        if (category) pushValue(m[0], m.index, raw, category);
      }
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  };

  // --- Étiquetés : toujours anonymisés, quel que soit le checksum -----------
  // SIRET/SIREN partagent leurs libellés dans les documents réels (« SIREN :
  // 55210055400041 » arrive) : on classe sur la LONGUEUR réelle, pas le libellé.
  const byLength = (v: string): CategoryType | null => {
    const n = digitsOf(v).length;
    if (n === 14) return 'SIRET';
    if (n === 9) return 'SIREN';
    return n >= 8 && n <= 15 ? 'COMPANY_ID' : null;
  };
  scanLabelled(SIRET_LABEL_RE, byLength);
  scanLabelled(SIREN_LABEL_RE, byLength);
  scanLabelled(RCS_LABEL_RE, byLength);
  scanLabelled(NIC_LABEL_RE, () => 'COMPANY_ID');
  scanLabelled(GESTION_LABEL_RE, () => 'COMPANY_ID');
  scanLabelled(URSSAF_LABEL_RE, () => 'COMPANY_ID');
  scanLabelled(ORIAS_LABEL_RE, () => 'COMPANY_ID');
  scanLabelled(RM_LABEL_RE, () => 'COMPANY_ID');
  scanLabelled(EORI_LABEL_RE, () => 'COMPANY_ID');
  scanLabelled(APE_LABEL_RE, () => 'APE_CODE');

  // --- Nus : checksum obligatoire ------------------------------------------
  const scanBare = (
    re: RegExp,
    accept: (value: string, start: number, end: number) => CategoryType | null,
  ) => {
    const rx = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const category = accept(m[0], m.index, m.index + m[0].length);
      if (category) {
        out.push({ value: m[0], startIndex: m.index, endIndex: m.index + m[0].length, category });
      }
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  };

  // SIRET nu : clé de Luhn valide -> aucun doute possible. Sinon on accepte
  // quand même en contexte entreprise, ou quand les 9 premiers chiffres forment
  // un SIREN valide : un vrai SIRET mal recopié (clé NIC fausse) doit être
  // anonymisé, pas laissé en clair.
  scanBare(SIRET_BARE_RE, (v, s, e) => {
    const digits = digitsOf(v);
    if (validSirenOrSiret(digits)) return 'SIRET';
    if (validSirenOrSiret(digits.slice(0, 9))) return 'SIRET';
    return hasBusinessContext(text, s, e) ? 'SIRET' : null;
  });
  // Le SIREN nu est ambigu (même forme qu'un NAS canadien) : on exige Luhn ET
  // un mot-clé entreprise à proximité. Sans contexte, le détecteur SIN/GOV_ID
  // générique prend le relais — aucune fuite dans les deux cas.
  scanBare(SIREN_BARE_RE, (v, s, e) => {
    if (!validSirenOrSiret(digitsOf(v))) return null;
    if (!hasBusinessContext(text, s, e)) return null;
    // Un SIREN précédé d'un préfixe de TVA intracommunautaire fait partie du
    // numéro de TVA : le laisser sortir séparément découperait « FR 40 303265045 ».
    const before = text.slice(Math.max(0, s - 8), s);
    if (/(?:^|[^A-Za-z0-9])[A-Z]{2}[ .-]?[0-9A-Z]{2}[ .-]?$/.test(before)) return null;
    return 'SIREN';
  });
  scanBare(RNA_BARE_RE, () => 'COMPANY_ID');
  scanBare(RIB_BARE_RE, (v) => (/[A-Z]/.test(v) || digitsOf(v).length === 23 ? 'IBAN' : null));

  // TVA FR : clé vérifiable -> toujours ; clé alphanumérique -> forme suffisante.
  const vatRe = new RegExp(VAT_FR_RE.source, VAT_FR_RE.flags);
  let vm: RegExpExecArray | null;
  while ((vm = vatRe.exec(text)) !== null) {
    if (validFrenchVat(vm[1], digitsOf(vm[2]))) {
      out.push({ value: vm[0], startIndex: vm.index, endIndex: vm.index + vm[0].length, category: 'VAT' });
    } else {
      // Clé fausse : on anonymise quand même si « TVA » est mentionné à côté
      // (coquille dans un vrai numéro) — sinon on laisse passer (ex. un code
      // produit « FR12 123 456 789 » qui n'est pas une TVA).
      const around = text.slice(Math.max(0, vm.index - 40), vm.index);
      if (/\bTVA\b|\bVAT\b|intracommunautaire/i.test(around)) {
        out.push({ value: vm[0], startIndex: vm.index, endIndex: vm.index + vm[0].length, category: 'VAT' });
      }
    }
    if (vm.index === vatRe.lastIndex) vatRe.lastIndex++;
  }

  // Un identifiant court inclus dans un identifiant plus long est un FRAGMENT :
  // le SIREN qu'on retrouve dans « URSSAF 117 000 000 001 234 56 » ou dans un
  // numéro de TVA ne doit pas exister en tant que détection séparée, sinon il
  // évince l'identifiant complet à l'étape de résolution des chevauchements et
  // laisse le reste des chiffres en clair.
  return out.filter(
    (a) =>
      !out.some(
        (b) =>
          b !== a &&
          b.startIndex <= a.startIndex &&
          a.endIndex <= b.endIndex &&
          b.endIndex - b.startIndex > a.endIndex - a.startIndex,
      ),
  );
}
