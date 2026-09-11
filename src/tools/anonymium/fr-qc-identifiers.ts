// Ported verbatim from Anonymum/src/utils/fr-qc-identifiers.ts.
import { scanLabelledIds, type LabelledIdMatch, type LabelledIdRule } from './labelled-id';

// Compléments d'identifiants France / Québec que les détecteurs historiques ne
// couvraient pas, ou couvraient sous une mauvaise catégorie.
//
// Comme pour les autres packs, les valeurs courtes et ambiguës (« 999 »,
// « 123 », « 4821 », « 00123 ») ne sont acceptées que derrière leur libellé :
// sans cette contrainte, le bloc de faux positifs du corpus de test
// (« 112 », « 3939 », « 69002 », « 4.2.1 ») serait massacré.

const RULES: LabelledIdRule[] = [
  // ---- France ----------------------------------------------------------
  {
    // Carte nationale d'identité française : 12 chiffres.
    label: 'carte\\s+nationale\\s+d[\'’]?\\s*identit[ée]|\\bCNI\\b',
    value: '\\d{12}',
    category: 'GOV_ID',
    requireSeparator: true,
  },
  {
    // RPPS (professionnel de santé) : 11 chiffres.
    label: 'RPPS',
    value: '\\d{11}',
    category: 'GOV_ID',
  },
  {
    // Matricule salarié : quasi-identifiant explicitement désigné comme tel
    // dans le corpus (« Le salarié matricule 004821 du service opérations »).
    // Le lookahead écarte « Matricule national : 1985 07 30 123 45 » (matricule
    // luxembourgeois) : un matricule salarié n'est pas suivi d'un autre groupe
    // de chiffres. Sans lui, on captait « 1985 » et le reste fuyait.
    label: 'matricule(?!\\s+national)(?:\\s+salari[ée])?',
    value: '\\d{4,8}(?!\\s*\\d)',
    category: 'EMPLOYEE_ID',
  },
  {
    // Numéro d'ordre au barreau.
    label: 'toque',
    value: '\\d{3,5}',
    category: 'LICENSE',
  },
  {
    // Plaque française d'ancienne série : « 4521 XY 75 ».
    label: 'immatriculation',
    value: '\\d{1,4}\\s?[A-Z]{2,3}\\s?\\d{2,3}',
    category: 'LICENSE_PLATE',
  },

  // ---- Québec / Canada -------------------------------------------------
  {
    // Passeport canadien : 2 lettres + 7 chiffres.
    label: 'passeport',
    value: '[A-Z]{2}\\d{7}',
    category: 'PASSPORT',
  },
  {
    label: 'compte\\s+(?:ch[èe]ques?|[ée]pargne|bancaire)',
    value: '\\d{7,12}',
    category: 'BANK_ACCOUNT',
    requireSeparator: true,
  },
  {
    label: 'transit',
    value: '\\d{5}',
    category: 'BANK_TRANSIT',
    requireSeparator: true,
  },
  {
    label: 'institution',
    value: '\\d{3}',
    category: 'BANK_INSTITUTION',
    requireSeparator: true,
  },
  {
    label: '\\bCVV\\b|\\bCVC\\b|cryptogramme',
    value: '\\d{3,4}',
    category: 'CVV',
    requireSeparator: true,
  },
  {
    label: '\\bNIP\\b|\\bPIN\\b|code\\s+secret',
    value: '\\d{4,6}',
    category: 'PASSWORD',
    requireSeparator: true,
  },
  {
    // La réponse à une question secrète est un secret d'authentification au
    // même titre que le mot de passe.
    label: 'r[ée]ponse(?:\\s+(?:fictive|secr[èe]te))?',
    value: '[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 -]{1,30}',
    category: 'PASSWORD',
    requireSeparator: true,
  },
  {
    // Permis professionnel québécois (courtage immobilier).
    label: 'OACIQ',
    value: '[A-Z]\\d{3,5}',
    category: 'LICENSE',
  },
];

// Numéro d'affaire au greffe : « RG 24/01887 ». Forme non ambiguë, pas besoin
// de libellé.
const RG_GREFFE = /\bRG\s?\d{2}\/\d{4,6}\b/g;

// Plus code (Open Location Code) : « 8FQ8VCJ5+9M ». C'est une géolocalisation
// au mètre près, donc une donnée de localisation à part entière.
const PLUS_CODE = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/g;

// Numéro d'entreprise ARC canadien : « 123456789RC0001 ». Sans cette règle, le
// détecteur SIREN mordait les 9 premiers chiffres et laissait « RC0001 » collé
// au placeholder.
const ARC_BUSINESS = /\b\d{9}(?:RC|RT|RP|RM)\d{4}\b/g;

// Numéro de carte Vitale : 8000 + 15 chiffres, écrits en groupes de 4. Il était
// réclamé par le détecteur de carte bancaire (mauvaise catégorie) et, en prose,
// tronqué par l'heuristique de mot de passe.
const CARTE_VITALE = /\b8000\s?\d{4}\s?\d{4}\s?\d{4}\s?\d\b/g;

// INE / BEA étudiant : 10 chiffres + 1 lettre. Le détecteur téléphone le
// réclamait et laissait la lettre finale en clair.
const INE_ETUDIANT = /\b\d{10}[A-Z]\b/g;

// NIR écrit avec des séparateurs inhabituels (« 1.85.03.47.323.456-78 »). Sous
// cette forme, le détecteur d'adresse IP en prenait le début.
const NIR_POINTE = /\b[12][.\s]\d{2}[.\s]\d{2}[.\s]\d{2,3}[.\s]\d{3}[.\s]\d{3}[-.\s]\d{2}\b/g;

export function detectFrQcIdentifiers(text: string): LabelledIdMatch[] {
  const out = scanLabelledIds(text, RULES);

  const scan = (re: RegExp, category: LabelledIdMatch['category']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ value: m[0], startIndex: m.index, endIndex: m.index + m[0].length, category });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };

  scan(RG_GREFFE, 'FILE_NUMBER');
  scan(PLUS_CODE, 'GPS_COORDINATES');
  scan(ARC_BUSINESS, 'COMPANY_ID');
  scan(CARTE_VITALE, 'HEALTH_CARD');
  scan(INE_ETUDIANT, 'STUDENT_CODE');
  scan(NIR_POINTE, 'NIR');

  return out;
}
