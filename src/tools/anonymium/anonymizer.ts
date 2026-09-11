// Ported from Anonymum/src/services/anonymizer.ts. Same detection algorithm:
// order-sensitive regex passes + national identifier packs + NER + manual
// rules, resolved by CATEGORY PRIORITY (see helpers.ts) and emitted as
// consistent per-category placeholders.
//
// Two app-side pieces are deliberately not ported: the canary watermark
// patterns (a licensing tell, not a detection rule) and the similarity
// suggestion API (UI-only). Document coherence IS ported — it is what keeps a
// value masked when it reappears under another spelling.

import type {
  Detection,
  Rule,
  MappingEntry,
  AnonymizerConfig,
  CategoryType,
  AnonymizationResult,
} from './types';

import {
  ACADEMIC_HINT_REGEX,
  HR_HINT_REGEX,
  LEGAL_HINT_REGEX,
  NAME_SECTION_HINT_REGEX,
  EMAIL_REGEX,
  PHONE_REGEX,
  PRICE_REGEX,
  IBAN_REGEX,
  BIC_REGEX,
  URL_REGEX,
  HANDLE_REGEX,
  DATE_FR_REGEX,
  DATE_FR_LONG_REGEX,
  DATE_ISO_REGEX,
  ISO_DATETIME_REGEX,
  DATE_EN_REGEX,
  DOB_REGEX,
  ADDRESS_FR_REGEX,
  ADDRESS_FR_CA_FULL_REGEX,
  ADDRESS_EN_REGEX,
  ZIP_US_REGEX,
  CREDIT_CARD_REGEX,
  CVV_REGEX,
  EXPIRY_REGEX,
  RIB_REGEX,
  NIR_REGEX,
  NIR_CTX_REGEX,
  SIRET_REGEX,
  SIREN_REGEX,
  PHONE_SHORT_FR_REGEX,
  LICENSE_PLATE_FR_REGEX,
  VAT_REGEX,
  SSN_US_REGEX,
  PASSPORT_REGEX,
  DRIVER_LICENSE_REGEX,
  HEALTH_CARD_REGEX,
  IPV4_REGEX,
  IPV6_REGEX,
  MAC_REGEX,
  API_KEY_REGEX,
  JWT_REGEX,
  BEARER_REGEX,
  AWS_SECRET_REGEX,
  PRIVATE_KEY_REGEX,
  PASSWORD_LINE_REGEX,
  USER_SECRET_INLINE_REGEX,
  USERNAME_LINE_REGEX,
  SESSION_ID_REGEX,
  OTP_CODE_REGEX,
  UUID_REGEX,
  CSRF_TOKEN_REGEX,
  TRANSACTION_ID_REGEX,
  FILE_NUMBER_REGEX,
  REFERENCE_ID_REGEX,
  EMPLOYEE_ID_REGEX,
  PROJECT_REGEX,
  ADDRESS_STREET_FR_REGEX,
  BARE_AMOUNT_REGEX,
  CITY_PROVINCE_POSTAL_CA_REGEX,
  INVOICE_HINT_REGEX,
  ORG_LEGAL_SUFFIX_REGEX,
  ACCOUNT_LAST_DIGITS_REGEX,
  PHONE_EXT_REGEX,
  PRO_PERMIT_REGEX,
  INVOICE_REGEX,
  LOT_CADASTRAL_REGEX,
  NPI_CTX_REGEX,
  RPPS_CTX_REGEX,
  ADELI_CTX_REGEX,
  DEA_CTX_REGEX,
  PHN_BC_CTX_REGEX,
  SEJOUR_CTX_REGEX,
  PR_CARD_CTX_REGEX,
  CITIZENSHIP_CTX_REGEX,
  SSN_CTX_REGEX,
  ABA_ROUTING_CTX_REGEX,
  EIN_CTX_REGEX,
  CNI_CTX_REGEX,
  CAF_CTX_REGEX,
  AVIS_IMPOT_CTX_REGEX,
  IMEI_CTX_REGEX,
  IMSI_CTX_REGEX,
  BARE_15_DIGITS_REGEX,
  PNR_CTX_REGEX,
  ACCESS_CODE_CTX_REGEX,
  AD_USERNAME_REGEX,
  GPS_DMS_REGEX,
  POSTAL_FR_CITY_REGEX,
  STATE_ZIP_US_REGEX,
  BANK_INSTITUTION_REGEX,
  BANK_TRANSIT_REGEX,
  BANK_ACCOUNT_REGEX,
  CREDIT_CARD_ONLY_REGEX,
  CARD_EXPIRY_ONLY_REGEX,
  CVV_ONLY_REGEX,
  POSTAL_CA_REGEX,
  GPS_REGEX,
  LOCATION_SENSITIVE_REGEX,
  JDBC_REGEX,
  CONNECTION_URI_REGEX,
  DB_HOST_REGEX,
  DB_USER_LINE_REGEX,
  DB_PASSWORD_LINE_REGEX,
  HOST_PORT_REGEX,
  SOCIAL_URL_REGEX,
  DOMAIN_REGEX,
  ORGANIZATION_NAME_REGEX,
  ORGANIZATION_FR_REGEX,
  COMPANY_FR_LEGAL_REGEX,
  BANK_NAME_REGEX,
  QC_BUSINESS_ID_REGEX,
  MEDICAL_RECORD_REGEX,
  MEDICATION_REGEX,
  HEALTH_ORG_REGEX,
  LICENSE_PLATE_REGEX,
  VIN_REGEX,
  CRYPTO_WALLET_REGEX,
  INSURANCE_POLICY_REGEX,
  INSURANCE_POLICY_BARE_REGEX,
  SALARY_REGEX,
  NAME_STANDALONE_LINE_REGEX,
  CODE_STANDALONE_LINE_REGEX,
  COURSE_OR_SESSION_CODE_REGEX,
  LABELLED_PERSON_LINE_REGEX,
  SELF_INTRO_PERSON_REGEX,
  TITLE_GLUED_PERSON_REGEX,
  ACADEMIC_PERMANENT_CODE_REGEX,
  ACADEMIC_TERM_REGEX,
  createIdRegex,
  findAllMatches,
  findTermInText,
} from './regex';
import {
  generateId,
  formatPlaceholder,
  placeholderLabel,
  sortByPosition,
  mergeRanges,
  escapeRegexString,
} from './helpers';
import { detectEntities } from './ner';
import { detectPhoneNumbers } from './phone';
import { detectNationalIds, luhnValid } from './national-ids';
import { detectInternationalAddresses } from './addresses';
import { detectFrenchBusinessIds } from './fr-identifiers';
import { detectFrenchAddresses } from './fr-address';
import { findStrongSecretTokens } from './secret-heuristics';
import { detectBeChLuIdentifiers } from './be-ch-lu-identifiers';
import { detectMaghrebAfricaIdentifiers } from './maghreb-africa-identifiers';
import { detectFrQcIdentifiers } from './fr-qc-identifiers';
import { detectIntlStreetAddresses } from './intl-street-address';
import { detectIntlOrganizations } from './organizations-intl';
import { findCoherenceDetections } from './document-coherence';

// Overlap resolution lives in helpers.mergeRanges: manual Rule > category
// priority > longer span. The app calls the same thing
// `resolveDetectionsByPriority`; the alias keeps the ported bodies readable.
const resolveDetectionsByPriority = mergeRanges;


// Un code introduit par un libellé de CATALOGUE désigne un article, pas une
// personne ni un dossier : « Référence produit : REF-8891-B », « code article »,
// « modèle », « n° de série du produit ». Le détecteur d'identifiants
// alphanumériques génériques doit les laisser en clair — sinon la sortie devient
// illisible sans qu'aucune donnée personnelle n'ait été protégée.
const CATALOGUE_LEAD =
  /\b(?:r[ée]f(?:\.|[ée]rence)?|code|num[ée]ro|n[o°])?\s*(?:produit|article|catalogue|mod[èe]le|version|norme)\s*[:=]?\s*$/i;

// Un nom propre collé à « RCS » / « greffe de » / « registre » est la ville du
// greffe d'immatriculation, pas une personne (« RCS Paris B 552 100 554 »).
const REGISTRY_LEAD = /\b(?:R\.?C\.?S\.?|greffe(?:\s+d[eu])?|registre)\s*$/i;


// Detect sensitive terms in text using regex detectors
export function detectWithRegex(text: string, config: AnonymizerConfig): Detection[] {
  const detections: Detection[] = [];

  const profile = config.anonymizationProfile ?? 'general';
  const strict = config.ultraStrict ?? false;
  const isAcademicLike = profile === 'academic' || ACADEMIC_HINT_REGEX.test(text);
  const isHrLike = profile === 'hr' || HR_HINT_REGEX.test(text);
  const isLegalLike = profile === 'legal' || LEGAL_HINT_REGEX.test(text);

  const overlapsAny = (
    a: { startIndex: number; endIndex: number },
    ranges: Array<{ startIndex: number; endIndex: number }>
  ) => ranges.some((b) => a.startIndex < b.endIndex && b.startIndex < a.endIndex);

  // Chevauchement où `a` n'est PAS le conteneur : sert aux détecteurs qui
  // doivent céder la place à un identifiant voisin, sauf quand ils l'englobent.
  // « 0 800 123 456 » est un numéro vert qui CONTIENT « 800 123 456 » (forme de
  // SIREN) : le téléphone doit gagner. À l'inverse, un NEQ de 10 chiffres a la
  // même étendue que le faux téléphone qu'il déclenche : l'identifiant gagne.
  const blockedBy = (
    a: { startIndex: number; endIndex: number },
    ranges: Array<{ startIndex: number; endIndex: number }>
  ) =>
    ranges.some(
      (b) =>
        a.startIndex < b.endIndex &&
        b.startIndex < a.endIndex &&
        !(a.startIndex <= b.startIndex && b.endIndex <= a.endIndex &&
          a.endIndex - a.startIndex > b.endIndex - b.startIndex),
    );

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
  const pushLabelValueOnly = (
    match: { value: string; startIndex: number; endIndex: number },
    category: CategoryType,
  ) => {
    const bySeparator = match.value.match(/(?:[:=]|\best\b)\s*(.+)$/i);
    const value = (bySeparator?.[1] ?? match.value).trim();
    if (!value) return;
    const localIndex = match.value.lastIndexOf(value);
    if (localIndex < 0) return;
    push(
      {
        value,
        startIndex: match.startIndex + localIndex,
        endIndex: match.startIndex + localIndex + value.length,
      },
      category,
    );
  };

  // Détecteurs « valeur seule » : la regex capture « <libellé> … <valeur> » en
  // groupe 1 ; on n'anonymise QUE la valeur pour garder le libellé lisible quel
  // que soit le séparateur (« : », « est », « is », ou aucun).
  const pushCaptureGroup = (source: RegExp, category: CategoryType) => {
    const re = new RegExp(source.source, source.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = m[1];
      if (value) {
        const at = m.index + m[0].lastIndexOf(value);
        push({ value, startIndex: at, endIndex: at + value.length }, category);
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };

  const pushLineMatch = (line: string, lineStart: number, category: CategoryType) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const offset = line.indexOf(trimmed);
    if (offset < 0) return;
    push(
      {
        value: trimmed,
        startIndex: lineStart + offset,
        endIndex: lineStart + offset + trimmed.length,
      },
      category,
    );
  };

  // Un token de nom = capitale (accentuée OK) + minuscules, avec un nombre
  // quelconque de segments à trait d'union ("Tremblay-Gagnon", "Marc-Antoine").
  // Le trait d'union doit être suivi d'une capitale : ainsi "Tremblay-" (tiret
  // orphelin) n'est PAS un token valide et on ne coupe plus un nom composé.
  // Chaque segment admet une reprise capitale après apostrophe ("D'Anjou",
  // "O'Brien", "L'Écuyer") — sinon le match s'arrêtait à l'apostrophe et
  // laissait fuiter « 'Anjou ».
  const PERSON_TOKEN_REGEX = /^[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*(?:['’][A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*)?(?:-[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*(?:['’][A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*)?)*$/;
  const personStopWords = new Set([
    'bonjour',
    'cordialement',
    'merci',
    'madame',
    'monsieur',
    'mme',
    'mr',
    'cours',
    'course',
    'session',
    'hiver',
    'printemps',
    'automne',
    'ete',
    'été',
    'année',
    'ann',
    'professeur',
    'prof',
    'nom',
    'code',
    'permanent',
    'accès',
    'oracle',
    'base',
    'données',
    'données',
    'mode',
    'anonymisation',
    // Institutions / noms communs capitalisés (évite les faux positifs PERSON)
    'conseil', 'municipal', 'municipale', 'mairie', 'ministère', 'ministere',
    'société', 'societe', 'banque', 'université', 'universite', 'collège',
    'college', 'hôpital', 'hopital', 'clinique', 'direction', 'département',
    'departement', 'bureau', 'association', 'comité', 'comite', 'commission',
    'assemblée', 'assemblee', 'fédération', 'federation', 'république',
    'republique', 'centrale', 'national', 'nationale', 'général', 'générale',
    'generale', 'régional', 'regional', 'agence', 'institut', 'fondation',
    'groupe', 'syndicat', 'service', 'associés', 'associes', 'avocats', 'notaires',
    // Jetons de chaîne « user agent » : « Intel Mac OS X 10_15_7 » produisait
    // le faux positif PERSON « Intel Mac ».
    'mozilla', 'macintosh', 'intel', 'mac', 'applewebkit', 'khtml', 'gecko',
    'safari', 'chrome', 'firefox', 'edge', 'windows', 'linux', 'android',
    // Marques / suffixes de société souvent capitalisés
    'american', 'express', 'visa', 'mastercard', 'discover', 'corp',
    'corporation', 'sarl',
    // Produits / marques web et moyens de paiement (jamais des prénoms)
    'wordpress', 'elementor', 'shopify', 'wix', 'vultr', 'ovh',
    'interac', 'paypal', 'virement', 'paiement', 'versement', 'acompte', 'stripe',
    // Titres / civilités
    'dr', 'dre', 'drs', 'pr', 'pre', 'prof', 'me', 'mtre',
    // Institutions financières / marques / organismes / médicaments (gazetteer
    // d'exclusion — garder synchronisé avec ner.ts STOP_WORDS_RAW)
    'desjardins', 'tangerine', 'scotiabank', 'cibc', 'bmo', 'rbc',
    'chase', 'citibank', 'citi', 'wells', 'fargo', 'amex', 'transit',
    'caf', 'urssaf', 'pôle', 'pole', 'emploi', 'livret',
    'harmonie', 'mutuelle', 'assurance', 'assurances', 'épargne', 'epargne',
    'ventolin', 'advil', 'tylenol', 'aspirine', 'doliprane', 'ozempic',
    // En-têtes de fiches / sections médicales et administratives
    'fiche', 'suivi', 'médical', 'medical', 'médicale', 'medicale', 'médicales', 'medicales',
    'informations', 'information', 'personnelles', 'personnel', 'personnelle',
    'sensibles', 'sensible', 'administratif', 'administrative', 'administratives',
    'financières', 'financière', 'financier', 'financieres', 'financiere',
    'antécédents', 'antecedents', 'diagnostic', 'diagnostics', 'traitement', 'traitements',
    'prescription', 'prescriptions', 'responsable', 'institution', 'coordonnées', 'coordonnees',
    // Vocabulaire de facture / commande / billetterie (EN + FR) : en tête de
    // colonne ou de ligne, ces mots capitalisés donnaient « Invoice Number »,
    // « Order Total », « Description Unit Price », « Dear A » en PERSON — qui
    // mangeaient même la lettre voisine (« [PERSON_3].S.K. Connexion »). Pas
    // « price » ni « bill » : ce sont de vrais patronymes anglais. (Pas « san »
    // non plus : rejeter « San Francisco » laissait le gazetteer marquer
    // « Francisco » seul — une ville à moitié couverte est pire qu'une ville
    // prise pour une personne, qui au moins est entièrement masquée.)
    'invoice', 'number', 'description', 'unit', 'quantity', 'amount', 'total', 'order',
    'subtotal', 'sub-total', 'dear', 'event', 'payment', 'purchase', 'supply', 'gross',
    'net', 'tax', 'ticket', 'admission', 'thank', 'please', 'receipt', 'item', 'items',
    'facture', 'montant', 'quantité', 'quantite', 'unitaire', 'commande', 'sous-total',
    'événement', 'evenement', 'billet', 'achat', 'taxe', 'taxes', 'reçu',
  ]);

  const personLeadStopWords = new Set([
    'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'ce', 'cet',
    'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
    'notre', 'nos', 'votre', 'vos', 'leur', 'leurs', 'au', 'aux', 'et', 'ou',
    'mais', 'donc', 'car', 'ni', 'or', 'nous', 'vous', 'ils', 'elles', 'je',
    'tu', 'il', 'elle', 'on', 'me', 'cher', 'chère', 'chere', 'chers',
  ]);

  const isLikelyPersonName = (value: string): boolean => {
    if (!value || /\[[A-Z_]+_\d+\]/.test(value)) return false;
    if (/\d/.test(value)) return false;
    const tokens = value
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(Boolean);
    if (tokens.length < 2 || tokens.length > 5) return false;
    // Un jeton d'UNE seule lettre n'est jamais un nom ici (les initiales
    // pointées ont leur propre motif, INITIAL). Sans ce garde-fou, « FACTURÉ
    // À » produisait le « nom » « É À » et le mot se retrouvait charcuté en
    // « FACTUR[PERSON_1] » — la pire des sorties : illisible ET non protégée.
    if (tokens.some((token) => token.length < 2)) return false;
    if (!tokens.every((token) => PERSON_TOKEN_REGEX.test(token))) return false;
    const lowered = tokens.map((token) => token.toLowerCase());
    if (lowered.some((token) => personStopWords.has(token))) return false;
    return true;
  };

  // ---- Pre-compute claimed ranges ---------------------------------------
  // Phone is computed FIRST so the IPv4 detector can skip phone-shaped
  // sequences like `06.12.34.56.78` (a French mobile number) that would
  // otherwise be carved into a fake IP + leftover `.78`.
  const d = config.detectors;
  const emailRanges = d.email ? findAllMatches(text, EMAIL_REGEX) : [];
  // Union regex maison + libphonenumber-js (international) — leak-safe : on ne
  // perd jamais la couverture regex, on ajoute les formats internationaux validés.
  const phoneRanges = d.phone
    ? [...findAllMatches(text, PHONE_REGEX), ...detectPhoneNumbers(text, config.phoneRegion)]
    : [];
  const urlRanges = d.url ? findAllMatches(text, URL_REGEX) : [];
  const ibanRanges = d.iban ? findAllMatches(text, IBAN_REGEX) : [];
  const ccRanges = d.creditCard ? findAllMatches(text, CREDIT_CARD_REGEX) : [];
  const ribRanges = d.iban ? findAllMatches(text, RIB_REGEX) : [];
  const apiKeyRanges = d.apiKey ? findAllMatches(text, API_KEY_REGEX) : [];
  const jwtRanges = d.apiKey ? findAllMatches(text, JWT_REGEX) : [];
  const bearerRanges = d.apiKey ? findAllMatches(text, BEARER_REGEX) : [];
  const awsSecretRanges = d.apiKey ? findAllMatches(text, AWS_SECRET_REGEX) : [];
  const privateKeyRanges = d.apiKey ? findAllMatches(text, PRIVATE_KEY_REGEX) : [];
  const passwordRanges = d.password ? findAllMatches(text, PASSWORD_LINE_REGEX) : [];
  const userSecretRanges = d.password ? findAllMatches(text, USER_SECRET_INLINE_REGEX) : [];
  const usernameRanges = d.password ? findAllMatches(text, USERNAME_LINE_REGEX) : [];
  const sessionRanges = d.apiKey ? findAllMatches(text, SESSION_ID_REGEX) : [];
  const fileNumberRanges = d.internalCode ? findAllMatches(text, FILE_NUMBER_REGEX) : [];
  const referenceRanges = d.internalCode ? findAllMatches(text, REFERENCE_ID_REGEX) : [];
  const employeeIdRanges = d.internalCode ? findAllMatches(text, EMPLOYEE_ID_REGEX) : [];
  const bankInstitutionRanges = d.iban ? findAllMatches(text, BANK_INSTITUTION_REGEX) : [];
  const bankTransitRanges = d.iban ? findAllMatches(text, BANK_TRANSIT_REGEX) : [];
  const bankAccountRanges = d.iban ? findAllMatches(text, BANK_ACCOUNT_REGEX) : [];
  const creditCardOnlyRanges = d.creditCard ? findAllMatches(text, CREDIT_CARD_ONLY_REGEX) : [];
  const cardExpiryOnlyRanges = d.creditCard ? findAllMatches(text, CARD_EXPIRY_ONLY_REGEX) : [];
  const cvvOnlyRanges = d.creditCard ? findAllMatches(text, CVV_ONLY_REGEX) : [];
  const uuidRanges = d.apiKey ? findAllMatches(text, UUID_REGEX) : [];
  const csrfRanges = d.apiKey ? findAllMatches(text, CSRF_TOKEN_REGEX) : [];
  const txnRanges = d.apiKey ? findAllMatches(text, TRANSACTION_ID_REGEX) : [];
  const jdbcRanges = d.apiKey ? findAllMatches(text, JDBC_REGEX) : [];
  const connectionUriRanges = d.apiKey ? findAllMatches(text, CONNECTION_URI_REGEX) : [];
  const dbHostRanges = d.apiKey ? findAllMatches(text, DB_HOST_REGEX) : [];
  const dbUserRanges = d.password ? findAllMatches(text, DB_USER_LINE_REGEX) : [];
  const dbPasswordRanges = d.password ? findAllMatches(text, DB_PASSWORD_LINE_REGEX) : [];
  const hostPortRanges = d.url ? findAllMatches(text, HOST_PORT_REGEX) : [];
  const socialUrlRanges = d.socialHandle ? findAllMatches(text, SOCIAL_URL_REGEX) : [];
  const domainRanges = d.url ? findAllMatches(text, DOMAIN_REGEX) : [];
  const organizationNameRanges = d.organization ? findAllMatches(text, ORGANIZATION_NAME_REGEX) : [];
  const organizationFrRanges = d.organization ? findAllMatches(text, ORGANIZATION_FR_REGEX) : [];
  const companyFrLegalRanges = d.organization ? findAllMatches(text, COMPANY_FR_LEGAL_REGEX) : [];
  const bankNameRanges = d.organization ? findAllMatches(text, BANK_NAME_REGEX) : [];
  const postalRanges = d.address ? findAllMatches(text, POSTAL_CA_REGEX) : [];
  const gpsRanges = d.address ? findAllMatches(text, GPS_REGEX) : [];
  const locationRanges = d.address ? findAllMatches(text, LOCATION_SENSITIVE_REGEX) : [];
  const medicalRecordRanges = d.internalCode ? findAllMatches(text, MEDICAL_RECORD_REGEX) : [];
  const medicationRanges = d.person ? findAllMatches(text, MEDICATION_REGEX) : [];
  const healthOrgRanges = d.organization ? findAllMatches(text, HEALTH_ORG_REGEX) : [];
  const licensePlateRanges = d.internalCode ? findAllMatches(text, LICENSE_PLATE_REGEX) : [];
  const vinRanges = d.internalCode ? findAllMatches(text, VIN_REGEX) : [];
  const cryptoRanges = d.internalCode ? findAllMatches(text, CRYPTO_WALLET_REGEX) : [];
  const insuranceRanges = d.internalCode ? findAllMatches(text, INSURANCE_POLICY_BARE_REGEX) : [];
  const healthCardRanges = d.governmentId ? findAllMatches(text, HEALTH_CARD_REGEX) : [];
  const passportRanges = d.passport ? findAllMatches(text, PASSPORT_REGEX) : [];
  const driverRanges = d.driverLicense ? findAllMatches(text, DRIVER_LICENSE_REGEX) : [];
  const nirRanges = d.governmentId ? findAllMatches(text, NIR_REGEX) : [];
  const siretRanges = d.governmentId ? findAllMatches(text, SIRET_REGEX) : [];
  const sirenRanges = d.governmentId ? findAllMatches(text, SIREN_REGEX) : [];
  const vatRanges = d.governmentId ? findAllMatches(text, VAT_REGEX) : [];
  const ssnRanges = d.governmentId ? findAllMatches(text, SSN_US_REGEX) : [];
  const nationalIdRanges = d.governmentId ? detectNationalIds(text) : [];
  // Packs nationaux libellés (BE/CH/LU et Maghreb/Afrique francophone). Leurs
  // valeurs sont des suites de chiffres banales : elles ne sont acceptées que
  // si leur libellé les annonce (voir labelled-id.ts). La priorité de catégorie
  // tranche ensuite face aux détecteurs génériques — un NIN algérien de 16
  // chiffres passe la somme de Luhn par coïncidence et serait sinon réclamé par
  // le détecteur de carte bancaire.
  const beChLuRanges = d.governmentId ? detectBeChLuIdentifiers(text) : [];
  const maghrebRanges = d.governmentId ? detectMaghrebAfricaIdentifiers(text) : [];
  const frQcRanges = d.governmentId ? detectFrQcIdentifiers(text) : [];
  // Identifiants d'entreprise français (SIRET, SIREN, RCS, TVA, NIC, APE/NAF,
  // RNA, EORI, URSSAF…). Calculés AVANT le téléphone : un SIRET compact fait
  // 14 chiffres et un SIREN 9 — le détecteur téléphone les réclamerait sinon.
  const frBusinessRanges = d.governmentId ? detectFrenchBusinessIds(text) : [];
  const ipv4Ranges = (d.ipAddress ? findAllMatches(text, IPV4_REGEX) : [])
    .filter((m) => !overlapsAny(m, phoneRanges))
    // Un NIR écrit « 1.85.03.47.323.456-78 » commence comme une IPv4 : c'est
    // l'identifiant national, pas une adresse réseau.
    .filter((m) => !overlapsAny(m, frQcRanges));
  const ipv6Ranges = d.ipAddress ? findAllMatches(text, IPV6_REGEX) : [];
  const macRanges = d.macAddress ? findAllMatches(text, MAC_REGEX) : [];
  const cvvRanges = d.creditCard ? findAllMatches(text, CVV_REGEX) : [];
  const expiryRanges = d.creditCard ? findAllMatches(text, EXPIRY_REGEX) : [];
  const dobRanges = d.date ? findAllMatches(text, DOB_REGEX) : [];
  const addressFrRanges = d.address ? findAllMatches(text, ADDRESS_FR_REGEX) : [];
  const addressFrCaFullRanges = d.address ? findAllMatches(text, ADDRESS_FR_CA_FULL_REGEX) : [];
  const addressStreetOnlyRanges = d.address ? findAllMatches(text, ADDRESS_STREET_FR_REGEX) : [];
  // Ligne « ville + province + code postal » d'un en-tête de facture, sans rue.
  const cityProvincePostalRanges = d.address ? findAllMatches(text, CITY_PROVINCE_POSTAL_CA_REGEX) : [];
  // Raison sociale complète terminée par une forme juridique (inc., ltée, SARL…).
  const orgLegalRanges = d.organization ? findAllMatches(text, ORG_LEGAL_SUFFIX_REGEX) : [];
  // Montants nus des colonnes de totaux — deux garde-fous, car « 1 034,78 »
  // sans devise est ambigu :
  //   1. le document doit ressembler à une facture ;
  //   2. le montant doit occuper une COLONNE : il finit la ligne, ou il est
  //      suivi d'un séparateur de colonne (deux espaces, une tabulation) ou
  //      d'un autre nombre. « Service … 10  90,00  900,00 » et « TOTAL
  //      1 034,78 » passent ; « Montant : 12 456,78 euros » — de la prose,
  //      suivie d'un mot — reste intact, comme l'exige le corpus. En prose, un
  //      montant n'identifie personne ; en colonne, c'est une ligne de facture.
  const isInvoiceLike = INVOICE_HINT_REGEX.test(text);
  const isColumnAmount = (end: number): boolean =>
    /^(?:[ \t]*(?:\r?\n|$)|[ \t]{2,}|[ \t]+\d)/.test(text.slice(end));
  const bareAmountRanges = d.price && isInvoiceLike
    ? findAllMatches(text, BARE_AMOUNT_REGEX).filter((m) => isColumnAmount(m.endIndex))
    : [];
  const addressEnRanges = d.address ? findAllMatches(text, ADDRESS_EN_REGEX) : [];
  const intlAddressRanges = d.address ? detectInternationalAddresses(text) : [];
  // Adresses françaises : voie + compléments + code postal/commune, recollés
  // même quand ils sont séparés par un simple retour à la ligne.
  const frAddressRanges = d.address ? detectFrenchAddresses(text) : [];
  // Adresses « voie puis numéro » (BE / CH / LU). Sans elles, « Rue du Rhône
  // 118 » partait en PERSON et le code postal restait en clair.
  const intlStreetRanges = d.address ? detectIntlStreetAddresses(text) : [];
  // Raisons sociales étrangères et employeurs cités en contexte.
  const intlOrgRanges = d.organization ? detectIntlOrganizations(text) : [];
  const zipRanges = d.address ? findAllMatches(text, ZIP_US_REGEX) : [];
  const dateFrRanges = d.date ? findAllMatches(text, DATE_FR_REGEX) : [];
  const dateFrLongRanges = d.date ? findAllMatches(text, DATE_FR_LONG_REGEX) : [];
  const dateIsoRanges = d.date ? findAllMatches(text, DATE_ISO_REGEX) : [];
  // Horodatage complet : calculé même si le détecteur de dates est coupé, car
  // il sert aussi de garde-fou contre HOST_PORT_REGEX (voir plus bas).
  const isoDateTimeRanges = findAllMatches(text, ISO_DATETIME_REGEX);
  const dateEnRanges = d.date ? findAllMatches(text, DATE_EN_REGEX) : [];
  const salaryRanges = d.salary ? findAllMatches(text, SALARY_REGEX) : [];
  const nameStandaloneRanges = d.person && (strict || isAcademicLike || isHrLike || isLegalLike)
    ? findAllMatches(text, NAME_STANDALONE_LINE_REGEX)
    : [];
  const codeStandaloneRanges = d.internalCode ? findAllMatches(text, CODE_STANDALONE_LINE_REGEX) : [];
  const courseSessionCodeRanges = d.internalCode && (strict || isAcademicLike)
    ? findAllMatches(text, COURSE_OR_SESSION_CODE_REGEX)
    : [];
  const labelledPersonRanges = d.person && (strict || isAcademicLike || isHrLike || isLegalLike)
    ? findAllMatches(text, LABELLED_PERSON_LINE_REGEX)
    : [];
  const selfIntroPersonRanges = d.person
    ? findAllMatches(text, SELF_INTRO_PERSON_REGEX)
    : [];
  // Token de nom hyphen-aware : chaque segment après un trait d'union doit
  // recommencer par une capitale, donc un nom composé ("Tremblay-Gagnon") est
  // capturé en entier au lieu de s'arrêter sur le tiret et de laisser fuiter
  // la 2e moitié.
  const NAME_SEG = `[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*(?:['’][A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*)?`;
  const NAME_TOK = `${NAME_SEG}(?:-${NAME_SEG})*`;
  // Prénom réduit à une initiale : « A. », « J.-M. ». Combiné à NAME_TOK, permet
  // de capturer « Dr. A. Martin » (sinon « A. Martin » — un vrai nom — fuyait).
  const INITIAL = `[A-ZÀ-ÖØ-Ý]\\.(?:-[A-ZÀ-ÖØ-Ý]\\.)*`;
  const NTI = `(?:${INITIAL}|${NAME_TOK})`;
  // Civilités (utilisées pour la capture ET le strip de l'honorifique).
  const TITLE = `(?:Madame|Monsieur|Mademoiselle|Mme|Mlle|M\\.|Mr\\.?|Dre?\\.?|Pre?\\.?|Prof\\.?|Me\\.?|Mtre\\.?)`;
  // Frontière de FIN explicite au lieu de \b : une lettre accentuée finale
  // (« Doré » → « é ») est vue comme un non-mot par \b, qui recule alors la fin
  // du match sur la consonne précédente (« Dor ») et laisse fuiter « é … ». On
  // remplace donc le \b final par « pas suivi d'une lettre de nom ». Le \b de
  // tête est conservé (le changer élargissait les points de départ et créait
  // des faux positifs).
  const NA = `(?![A-Za-zÀ-ÖØ-öø-ÿ])`; // pas suivi d'une lettre de nom
  const inlineFullNameRanges =
    d.person
      ? findAllMatches(
          text,
          new RegExp(`\\b${NAME_TOK}(?:[ \\t]+${NAME_TOK}){1,4}${NA}`, 'g'),
        )
      : [];
  const titledPersonRanges =
    d.person
      ? findAllMatches(
          text,
          new RegExp(`\\b${TITLE}[ \\t]+${NTI}(?:[ \\t]+${NTI}){0,3}${NA}`, 'g'),
        )
      : [];
  const academicPermanentCodeRanges =
    d.internalCode && (strict || isAcademicLike) ? findAllMatches(text, ACADEMIC_PERMANENT_CODE_REGEX) : [];
  const academicTermRanges =
    d.date && (strict || isAcademicLike) ? findAllMatches(text, ACADEMIC_TERM_REGEX) : [];
  const priceRanges = d.price ? findAllMatches(text, PRICE_REGEX) : [];

  // ---- Email -------------------------------------------------------------
  for (const m of emailRanges) push(m, 'EMAIL');
  // Contextual person hint near email (e.g. "mon email est larry lalong20@gmail.com")
  if (d.person && d.email) {
    const introEmailMatches = findAllMatches(
      text,
      /\b(?:mon\s+email\s+est|my\s+email\s+is|adresse\s+utilisateur\s*:?)\s+([a-zà-öø-ÿ'’-]{2,}(?:\s+[a-zà-öø-ÿ'’-]{2,})?)\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu,
    );
    for (const m of introEmailMatches) {
      const found = m.value.match(
        /(?:mon\s+email\s+est|my\s+email\s+is|adresse\s+utilisateur\s*:?)\s+([a-zà-öø-ÿ'’-]{2,}(?:\s+[a-zà-öø-ÿ'’-]{2,})?)\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu,
      );
      const personPart = found?.[1]?.trim();
      if (!personPart) continue;
      const localIndex = m.value.toLowerCase().indexOf(personPart.toLowerCase());
      if (localIndex < 0) continue;
      push(
        {
          value: personPart,
          startIndex: m.startIndex + localIndex,
          endIndex: m.startIndex + localIndex + personPart.length,
        },
        'PERSON',
      );
    }
  }

  // ---- Free-text PII context (semantic — claim BEFORE date/name detectors) -
  for (const m of salaryRanges) push(m, 'SALARY');
  for (const m of nameStandaloneRanges) push(m, 'PERSON');
  for (const m of labelledPersonRanges) {
    const colon = m.value.indexOf(':');
    if (colon === -1) continue;
    const rawValue = m.value.slice(colon + 1).trim();
    const person = rawValue
      .replace(/^(?:M\.|Mme|Mlle|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Me\.?|Monsieur|Madame)\s+/i, '')
      .replace(/[.,;:!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!person || !/^[A-ZÀ-ÖØ-Ý]/.test(person) || !/\s/.test(person)) continue;
    const localIndex = m.value.indexOf(person);
    if (localIndex === -1) continue;
    push(
      {
        value: person,
        startIndex: m.startIndex + localIndex,
        endIndex: m.startIndex + localIndex + person.length,
      },
      'PERSON',
    );
  }
  for (const m of inlineFullNameRanges) {
    if (REGISTRY_LEAD.test(text.slice(Math.max(0, m.startIndex - 14), m.startIndex))) continue;
    const normalized = m.value.replace(/\s+/g, ' ').trim();
    const tokens = normalized.split(' ');
    // Drop leading determiners/conjunctions glued onto a name by sentence start
    // (e.g. "Le Conseil Municipal", "Et Jean Dupont") without losing the name.
    let drop = 0;
    while (tokens.length - drop > 2 && personLeadStopWords.has(tokens[drop].toLowerCase())) drop++;
    const value = tokens.slice(drop).join(' ');
    if (!isLikelyPersonName(value)) continue;
    const droppedPrefix = tokens.slice(0, drop).join(' ');
    const offset = droppedPrefix ? droppedPrefix.length + 1 : 0;
    push(
      {
        value,
        startIndex: m.startIndex + offset,
        endIndex: m.startIndex + offset + value.length,
      },
      'PERSON',
    );
  }
  for (const m of selfIntroPersonRanges) {
    // Même discipline que SELF_INTRO_PERSON_REGEX : pas de /i (la valeur est en
    // minuscules) et pas de \s (on ne franchit pas la ligne).
    const introMatch = m.value.match(
      /(?:[Jj]e\s+m['’]?\s*appelle?|[Jj]e\s+m\s+appel|[Nn][Oo][Mm](?:[ \t]+[Cc]omplet)?|[Mm]y\s+name\s+is)[ \t]*[:=]?[ \t]+(.+)$/u,
    );
    const person = introMatch?.[1]?.trim().replace(/\s+/g, ' ');
    if (!person) continue;
    const localIndex = m.value.toLowerCase().lastIndexOf(person.toLowerCase());
    if (localIndex < 0) continue;
    push(
      {
        value: person,
        startIndex: m.startIndex + localIndex,
        endIndex: m.startIndex + localIndex + person.length,
      },
      'PERSON',
    );
  }
  // On retire l'honorifique du span anonymisé : ainsi "Madame Émilie
  // Tremblay-Gagnon" produit le MÊME placeholder que la signature "Émilie
  // Tremblay-Gagnon" (cohérence), et "Madame" reste lisible.
  const titleStripRe = new RegExp(`^${TITLE}[ \\t]+`);
  for (const m of titledPersonRanges) {
    const stripped = m.value.replace(titleStripRe, '');
    const offset = m.value.length - stripped.length;
    push(
      { value: stripped, startIndex: m.startIndex + offset, endIndex: m.endIndex },
      'PERSON',
    );
  }

  // If a line already contains a person placeholder, anonymize any
  // remaining standalone person tokens around it (e.g. "Kameni [PERSON_2] Ezzo").
  if (d.person) {
    const lines = text.split(/\r?\n/);
    let cursor = 0;
    for (const rawLine of lines) {
      const lineStart = cursor;
      cursor += rawLine.length + 1;
      if (!/\[PERSON_\d+\]/.test(rawLine)) continue;

      const cleaned = rawLine.replace(/\[[A-Z_]+_\d+\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!isLikelyPersonName(cleaned)) continue;

      const tokenRegex = /[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*(?:['’][A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*)?(?:-[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*(?:['’][A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’]*)?)*/g;
      let tokenMatch: RegExpExecArray | null;
      while ((tokenMatch = tokenRegex.exec(rawLine)) !== null) {
        const token = tokenMatch[0];
        if (!PERSON_TOKEN_REGEX.test(token)) continue;
        if (personStopWords.has(token.toLowerCase())) continue;
        push(
          {
            value: token,
            startIndex: lineStart + tokenMatch.index,
            endIndex: lineStart + tokenMatch.index + token.length,
          },
          'PERSON',
        );
      }
    }
  }

  // ---- Date-of-birth phrasing — claim prefix + date together --------------
  for (const m of dobRanges) push(m, 'DATE');

  // ---- Addresses ---------------------------------------------------------
  for (const m of frAddressRanges) push(m, m.category);
  for (const m of addressFrCaFullRanges) push(m, 'ADDRESS');
  for (const m of addressFrRanges) {
    if (overlapsAny(m, addressFrCaFullRanges)) continue;
    push(m, 'ADDRESS');
  }
  for (const m of addressEnRanges) push(m, 'ADDRESS');
  for (const m of intlAddressRanges) push(m, m.category);
  for (const m of zipRanges) {
    if (overlapsAny(m, addressEnRanges)) continue;
    push(m, 'ADDRESS');
  }
  // Rue seule (« 2900 boul. des Forges ») : les adresses complètes qui la
  // recouvrent gagnent (match plus long à priorité égale).
  for (const m of addressStreetOnlyRanges) {
    if (overlapsAny(m, addressFrCaFullRanges) || overlapsAny(m, addressFrRanges) || overlapsAny(m, addressEnRanges)) continue;
    push(m, 'ADDRESS');
  }

  // ---- Bank / payment ----------------------------------------------------
  for (const m of ribRanges) push(m, 'IBAN');
  for (const m of ibanRanges) {
    // Un EORI français (« FR » + les 14 chiffres du SIRET) a la forme d'un IBAN
    // court. Quand un identifiant d'entreprise couvre exactement la même plage,
    // c'est lui qui porte la bonne étiquette.
    if (frBusinessRanges.some((b) => b.startIndex <= m.startIndex && m.endIndex <= b.endIndex)) continue;
    push(m, 'IBAN');
  }
  for (const m of bankInstitutionRanges) pushLabelValueOnly(m, 'BANK_INSTITUTION');
  for (const m of bankTransitRanges) pushLabelValueOnly(m, 'BANK_TRANSIT');
  for (const m of bankAccountRanges) pushLabelValueOnly(m, 'BANK_ACCOUNT');
  for (const m of ccRanges) push(m, 'CARD');
  for (const m of creditCardOnlyRanges) {
    if (overlapsAny(m, ibanRanges) || overlapsAny(m, ribRanges)) continue;
    push(m, 'CREDIT_CARD');
  }
  for (const m of cvvRanges) push(m, 'CARD');
  for (const m of cvvOnlyRanges) {
    if (overlapsAny(m, cvvRanges) || overlapsAny(m, ccRanges)) continue;
    if (!/\b(?:cvv|cvc|cv2|ccv)\b/i.test(text.slice(Math.max(0, m.startIndex - 8), m.endIndex + 2))) continue;
    push(m, 'CVV');
  }
  for (const m of expiryRanges) push(m, 'CARD');
  for (const m of cardExpiryOnlyRanges) {
    if (overlapsAny(m, expiryRanges) || overlapsAny(m, ccRanges)) continue;
    push(m, 'CARD_EXPIRY');
  }

  // ---- BIC (skip overlap with VAT prefix collision) ----------------------
  // Le motif BIC (AAAA CC LL [BBB]) matche n'importe quel mot de 8 ou 11
  // lettres capitales — donc des mots français en MAJUSCULES (PRESTATIONS,
  // PAIEMENT, ACCEPTATION) passaient pour des codes SWIFT. On exige désormais
  // un discriminant : soit le candidat contient un chiffre (code
  // localisation/branche d'un vrai BIC), soit il est étiqueté « BIC »/« SWIFT »
  // juste avant. Un BIC tout-lettres non étiqueté (rare) est volontairement
  // ignoré : la sur-rédaction d'un mot courant serait pire.
  if (d.iban) {
    const bicMatches = findAllMatches(text, BIC_REGEX);
    for (const m of bicMatches) {
      if (overlapsAny(m, vatRanges)) continue;
      const hasDigit = /\d/.test(m.value);
      const ctxBefore = text.slice(Math.max(0, m.startIndex - 12), m.startIndex);
      const labelled = /\b(?:bic|swift)\b/i.test(ctxBefore);
      if (!hasDigit && !labelled) continue;
      push(m, 'SWIFT_CODE');
    }
  }

  // ---- National / government IDs ----------------------------------------
  for (const m of nirRanges) push(m, 'NIR');
  for (const m of siretRanges) push(m, 'SIRET');
  for (const m of sirenRanges) {
    if (overlapsAny(m, siretRanges)) continue;
    push(m, 'GOV_ID');
  }
  for (const m of vatRanges) push(m, 'VAT');
  for (const m of ssnRanges) push(m, 'SSN');
  for (const m of nationalIdRanges) push(m, m.category);
  for (const m of beChLuRanges) push(m, m.category);
  for (const m of maghrebRanges) push(m, m.category);
  for (const m of frQcRanges) push(m, m.category);
  for (const m of intlStreetRanges) push(m, m.category);
  for (const m of intlOrgRanges) push(m, m.category);
  // ADDRESS (84) passe devant POSTAL_CODE (83) et PERSON (68) : la ligne
  // entière l'emporte sur le seul code postal et sur la ville prise pour un nom.
  for (const m of cityProvincePostalRanges) push(m, 'ADDRESS');
  // Même catégorie que le NER : à chevauchement, le match le plus long gagne,
  // donc « Agence Bertrand inc. » l'emporte sur « Bertrand inc ».
  for (const m of orgLegalRanges) push(m, 'COMPANY');
  // Civilité collée au nom : on n'anonymise que le nom capturé.
  if (d.person) pushCaptureGroup(TITLE_GLUED_PERSON_REGEX, 'PERSON');
  for (const m of frBusinessRanges) push(m, m.category);
  if (d.governmentId) pushCaptureGroup(NIR_CTX_REGEX, 'NIR');

  // ---- Identifiants d'entreprise QC/CA (NEQ / TPS / TVQ) -----------------
  // Capturés par leur libellé. On n'anonymise QUE la valeur (le numéro, avec
  // son compte de programme RT/TQ s'il y en a) et on garde « NEQ : » lisible.
  // Renseignés AVANT le téléphone pour qu'il ne réclame pas ces nombres de
  // 10 chiffres (le détecteur téléphone NA matche tout nombre de 10 chiffres).
  const qcBusinessRanges: Array<{ value: string; startIndex: number; endIndex: number }> = [];
  if (d.governmentId) {
    const qcRe = new RegExp(QC_BUSINESS_ID_REGEX.source, 'gi');
    let qm: RegExpExecArray | null;
    while ((qm = qcRe.exec(text)) !== null) {
      const label = qm[1];
      const val = qm[2];
      if (!val) { if (qm.index === qcRe.lastIndex) qcRe.lastIndex++; continue; }
      const valStart = qm.index + qm[0].indexOf(val, label.length);
      const range = { value: val, startIndex: valStart, endIndex: valStart + val.length };
      qcBusinessRanges.push(range);
      // TPS/GST/TVQ/QST = numéros de taxe -> VAT ; NEQ = registre -> GOV_ID.
      push(range, /^(?:TPS|GST|TVQ|QST)$/i.test(label) ? 'VAT' : 'GOV_ID');
      if (qm.index === qcRe.lastIndex) qcRe.lastIndex++;
    }
  }
  // Passeport / permis : la regex capture "<mot-clé> ... <ID>" ; on n'anonymise
  // que l'identifiant en fin de match, en gardant le libellé lisible.
  const pushTrailingId = (
    match: { value: string; startIndex: number; endIndex: number },
    category: CategoryType,
  ) => {
    const id = match.value.match(/[A-Z0-9](?:[A-Z0-9-]{4,18}[A-Z0-9])?$/);
    if (!id) { push(match, category); return; }
    const at = match.startIndex + match.value.length - id[0].length;
    push({ value: id[0], startIndex: at, endIndex: at + id[0].length }, category);
  };
  for (const m of passportRanges) pushTrailingId(m, 'PASSPORT');
  for (const m of driverRanges) pushTrailingId(m, 'DRIVER_LICENSE');
  for (const m of healthCardRanges) {
    // 4 lettres + 8 chiffres = identifiant personnel québécois au format ambigu :
    // carte d'assurance maladie (RAMQ) ET code permanent scolaire partagent ce
    // format. On classe selon le contexte, avec un repli neutre GOV_ID — mais on
    // anonymise toujours.
    const around = text.slice(Math.max(0, m.startIndex - 50), m.endIndex + 15).toLowerCase();
    let category: CategoryType = 'GOV_ID';
    if (/assurance\s+maladie|\bramq\b|carte\s+(?:d['’]assurance\s+)?(?:maladie|sant[ée]|soleil)|health\s+card/.test(around)) {
      category = 'HEALTH_CARD';
    } else if (isAcademicLike || /code\s+permanent|permanent\s+code|[ée]tudiant|student/.test(around)) {
      category = 'STUDENT_CODE';
    }
    push(m, category);
  }

  // ---- Network / technical ----------------------------------------------
  for (const m of ipv4Ranges) push(m, 'IP');
  for (const m of ipv6Ranges) push(m, 'IPV6');
  for (const m of macRanges) push(m, 'MAC_ADDRESS');
  // Un horodatage ISO 8601 n'est pas un couple hôte:port. « 2026-08-14T09:14 »
  // satisfait pourtant HOST_PORT_REGEX (l'hôte « 2026-08-14T09 » contient une
  // lettre, « :14 » fait un port plausible) et découpait le timestamp.
  for (const m of hostPortRanges) {
    if (overlapsAny(m, isoDateTimeRanges)) continue;
    push(m, 'HOST');
  }
  if (d.date) for (const m of isoDateTimeRanges) push(m, 'DATE');
  for (const m of dbHostRanges) push(m, 'DB_HOST');

  // ---- URLs --------------------------------------------------------------
  for (const m of urlRanges) push(m, 'URL');
  for (const m of socialUrlRanges) push(m, 'SOCIAL_URL');
  for (const m of jdbcRanges) push(m, 'DB_CONNECTION_STRING');
  for (const m of connectionUriRanges) push(m, 'DB_CONNECTION_STRING');
  for (const m of organizationNameRanges) push(m, 'ORGANIZATION');
  for (const m of organizationFrRanges) {
    if (overlapsAny(m, emailRanges) || overlapsAny(m, urlRanges)) continue;
    push(m, 'ORGANIZATION');
  }
  // ORGANIZATION (69) et non COMPANY (67) : la raison sociale complète doit
  // l'emporter sur la capture partielle en PERSON (68) que produit le NER.
  for (const m of companyFrLegalRanges) {
    if (overlapsAny(m, emailRanges) || overlapsAny(m, urlRanges)) continue;
    push(m, 'ORGANIZATION');
  }
  for (const m of bankNameRanges) push(m, 'BANK_NAME');
  for (const m of domainRanges) {
    if (
      overlapsAny(m, emailRanges) ||
      overlapsAny(m, urlRanges) ||
      overlapsAny(m, socialUrlRanges) ||
      overlapsAny(m, organizationNameRanges)
    ) continue;
    push(m, 'DOMAIN');
  }

  // ---- Social handles (skip if part of an email) ------------------------
  if (d.socialHandle) {
    const handleMatches = findAllMatches(text, HANDLE_REGEX).filter(
      (h) =>
        !overlapsAny(h, emailRanges) &&
        !overlapsAny(h, passwordRanges) &&
        !overlapsAny(h, userSecretRanges) &&
        !overlapsAny(h, apiKeyRanges) &&
        !overlapsAny(h, jwtRanges) &&
        !overlapsAny(h, bearerRanges)
    );
    for (const m of handleMatches) push(m, 'HANDLE');
  }

  // ---- Dates -------------------------------------------------------------
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
  for (const m of academicTermRanges) push(m, 'DATE');

  // ---- Secrets -----------------------------------------------------------
  for (const m of apiKeyRanges) push(m, 'API_KEY');
  for (const m of awsSecretRanges) pushLabelValueOnly(m, 'API_KEY');
  for (const m of privateKeyRanges) push(m, 'API_KEY');
  for (const m of jwtRanges) push(m, 'TOKEN');
  for (const m of bearerRanges) push(m, 'TOKEN');
  for (const m of uuidRanges) push(m, 'UUID');
  for (const m of csrfRanges) push(m, 'CSRF_TOKEN');
  for (const m of txnRanges) push(m, 'TRANSACTION_ID');
  for (const m of sessionRanges) pushLabelValueOnly(m, 'SESSION_ID');
  if (d.otpCode) pushCaptureGroup(OTP_CODE_REGEX, 'OTP_CODE');
  if (d.phone) pushCaptureGroup(PHONE_EXT_REGEX, 'PHONE');
  if (d.phone) pushCaptureGroup(PHONE_SHORT_FR_REGEX, 'PHONE');
  if (d.iban) pushCaptureGroup(ACCOUNT_LAST_DIGITS_REGEX, 'BANK_ACCOUNT');
  if (d.governmentId) pushCaptureGroup(PRO_PERMIT_REGEX, 'GOV_ID');
  if (d.internalCode) pushCaptureGroup(INVOICE_REGEX, 'REFERENCE_ID');
  if (d.internalCode) pushCaptureGroup(LOT_CADASTRAL_REGEX, 'REFERENCE_ID');
  // ---- Identifiants à contexte lexical (multi-juridictions) ---------------
  // Le mot-clé prime sur la forme brute (voir regex.ts). Un checksum invalide
  // n'exclut PAS si le libellé est présent — sur-rédiger est le côté sûr.
  if (d.governmentId) {
    pushCaptureGroup(NPI_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(RPPS_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(ADELI_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(DEA_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(PHN_BC_CTX_REGEX, 'HEALTH_CARD');
    pushCaptureGroup(SEJOUR_CTX_REGEX, 'IMMIGRATION_ID');
    pushCaptureGroup(PR_CARD_CTX_REGEX, 'IMMIGRATION_ID');
    pushCaptureGroup(CITIZENSHIP_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(SSN_CTX_REGEX, 'SSN');
    pushCaptureGroup(EIN_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(CNI_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(CAF_CTX_REGEX, 'GOV_ID');
    pushCaptureGroup(AVIS_IMPOT_CTX_REGEX, 'GOV_ID');
  }
  if (d.iban) pushCaptureGroup(ABA_ROUTING_CTX_REGEX, 'BANK_TRANSIT');
  if (d.internalCode) {
    pushCaptureGroup(IMEI_CTX_REGEX, 'ID');
    pushCaptureGroup(IMSI_CTX_REGEX, 'ID');
    pushCaptureGroup(PNR_CTX_REGEX, 'REFERENCE_ID');
    // IMEI nu (sans mot-clé) : 15 chiffres + Luhn valide. Un IMSI nu (Luhn
    // rarement valide) reste intact plutôt que mal classé — le contexte prime.
    for (const m of findAllMatches(text, BARE_15_DIGITS_REGEX)) {
      if (luhnValid(m.value)) push(m, 'ID');
    }
  }
  if (d.password) pushCaptureGroup(ACCESS_CODE_CTX_REGEX, 'PASSWORD');
  if (d.password) for (const m of findAllMatches(text, AD_USERNAME_REGEX)) push(m, 'USERNAME');
  if (d.address) {
    for (const m of findAllMatches(text, GPS_DMS_REGEX)) push(m, 'GPS_COORDINATES');
    for (const m of findAllMatches(text, POSTAL_FR_CITY_REGEX)) push(m, 'ADDRESS');
    pushCaptureGroup(STATE_ZIP_US_REGEX, 'POSTAL_CODE');
  }
  for (const m of passwordRanges) pushLabelValueOnly(m, 'PASSWORD');
  for (const m of userSecretRanges) push(m, 'PASSWORD');
  // Jetons « en forme de mot de passe » sans libellé (« Le temporaire est :
  // Hiver2026!Tremblay ») — on écarte tout chevauchement avec email/URL.
  if (d.password) {
    for (const m of findStrongSecretTokens(text)) {
      if (overlapsAny(m, emailRanges) || overlapsAny(m, urlRanges)) continue;
      if (overlapsAny(m, frQcRanges)) continue;
      push(m, 'PASSWORD');
    }
  }
  for (const m of usernameRanges) pushLabelValueOnly(m, 'USERNAME');
  for (const m of dbUserRanges) pushLabelValueOnly(m, 'DB_USER');
  for (const m of dbPasswordRanges) pushLabelValueOnly(m, 'DB_PASSWORD');

  // ---- Phone -------------------------------------------------------------
  // Phone uses a NARROWER overlap check than the alphanumeric-ID detector:
  // it only cares about IBAN / URL / price, since the phone regex starts
  // with `+` or `0` and won't realistically collide with the other patterns.
  if (d.phone) {
    for (const m of phoneRanges) {
      if (
        overlapsAny(m, ibanRanges) || overlapsAny(m, urlRanges) || overlapsAny(m, priceRanges) ||
        blockedBy(m, vatRanges) || blockedBy(m, nirRanges) || blockedBy(m, siretRanges) ||
        // Un INE étudiant (« 0612345678H ») commence exactement comme un mobile
        // français : l'identifiant, plus long, doit gagner — sinon la lettre
        // finale reste en clair à côté du placeholder.
        blockedBy(m, frQcRanges) ||
        blockedBy(m, sirenRanges) || blockedBy(m, ssnRanges) ||
        overlapsAny(m, ccRanges) || overlapsAny(m, creditCardOnlyRanges) ||
        overlapsAny(m, bankAccountRanges) || blockedBy(m, qcBusinessRanges) ||
        blockedBy(m, frBusinessRanges)
      ) continue;
      push(m, 'PHONE');
    }
  }

  // ---- Price -------------------------------------------------------------
  if (d.price) {
    for (const m of priceRanges) {
      if (overlapsAny(m, emailRanges) || overlapsAny(m, ibanRanges) || overlapsAny(m, urlRanges)) continue;
      if (overlapsAny(m, salaryRanges)) continue;
      push(m, 'PRICE');
    }
    // Montants nus (« TOTAL 1 034,78 »). PRICE a une priorité basse (45), donc
    // toute date, tout téléphone ou tout identifiant qui recouvrirait le même
    // texte gagne d'office à la résolution — on peut pousser sans crainte.
    for (const m of bareAmountRanges) {
      if (overlapsAny(m, priceRanges) || overlapsAny(m, salaryRanges)) continue;
      if (overlapsAny(m, emailRanges) || overlapsAny(m, ibanRanges) || overlapsAny(m, urlRanges)) continue;
      push(m, 'PRICE');
    }
  }

  // ---- Numéro de projet / dossier ---------------------------------------
  // Capturé par son libellé (« Projet #992-B », « Projet : ABC-2024-17 »). On
  // n'anonymise que le code (groupe 1) et on garde « Projet # » lisible.
  if (d.internalCode) {
    const projRe = new RegExp(PROJECT_REGEX.source, 'g');
    let pm: RegExpExecArray | null;
    while ((pm = projRe.exec(text)) !== null) {
      const code = pm[1];
      if (!code) { if (pm.index === projRe.lastIndex) projRe.lastIndex++; continue; }
      const at = pm.index + pm[0].lastIndexOf(code);
      push({ value: code, startIndex: at, endIndex: at + code.length }, 'PROJECT');
      if (pm.index === projRe.lastIndex) projRe.lastIndex++;
    }
  }

  // ---- Alphanumeric internal IDs ----------------------------------------
  // We deliberately do NOT pre-reject overlaps here: when an alphanumeric
  // code like `DOSS-2024-11-28-ABC123DEF` contains a substring that matches
  // a narrower detector (ISO date), pushing both lets `mergeRanges` keep the
  // longer match — preserving the full code instead of leaking its prefix
  // and suffix around the date placeholder. We still skip emails (caught
  // above), URLs/prices (which always claim their own range), and pure-digit
  // matches (phone fragments).
  if (d.internalCode) {
    const idRegex = createIdRegex(config.idMinLength);
    const idMatches = findAllMatches(text, idRegex);

    const emailValues = new Set(emailRanges.map((m) => m.value));

    for (const m of idMatches) {
      if (emailValues.has(m.value)) continue;
      if (overlapsAny(m, urlRanges) || overlapsAny(m, priceRanges)) continue;
      if (
        overlapsAny(m, phoneRanges) ||
        overlapsAny(m, ipv4Ranges) ||
        overlapsAny(m, ipv6Ranges) ||
        overlapsAny(m, passwordRanges) ||
        overlapsAny(m, userSecretRanges) ||
        overlapsAny(m, academicPermanentCodeRanges) ||
        overlapsAny(m, fileNumberRanges) ||
        overlapsAny(m, referenceRanges) ||
        overlapsAny(m, employeeIdRanges) ||
        overlapsAny(m, passportRanges) ||
        overlapsAny(m, driverRanges) ||
        overlapsAny(m, bankAccountRanges) ||
        overlapsAny(m, sessionRanges) ||
        overlapsAny(m, uuidRanges) ||
        overlapsAny(m, txnRanges)
      ) continue;
      if (/^\d+$/.test(m.value)) continue;
      if (/^[A-Z]{4}\d{8}$/.test(m.value)) continue;
      if (/^(?:\[[A-Z_]+_\d+\]|\{[A-Z_]+_\d+\}|[A-Z_]+_\d+)$/.test(m.value)) continue;
      if (CATALOGUE_LEAD.test(text.slice(Math.max(0, m.startIndex - 40), m.startIndex))) continue;
      push(m, 'ID');
    }

    for (const m of codeStandaloneRanges) {
      if (overlapsAny(m, emailRanges) || overlapsAny(m, urlRanges) || overlapsAny(m, priceRanges)) continue;
      if (/^(?:\[[A-Z_]+_\d+\]|\{[A-Z_]+_\d+\}|[A-Z_]+_\d+)$/.test(m.value)) continue;
      push(m, 'ID');
    }

    for (const m of courseSessionCodeRanges) {
      if (overlapsAny(m, emailRanges) || overlapsAny(m, urlRanges)) continue;
      const colon = m.value.indexOf(':');
      // Sans deux-points (« Groupe 04 ») : la valeur est le token final du match.
      const value = colon === -1
        ? (m.value.match(/[A-Z0-9._-]+$/i)?.[0] ?? '')
        : m.value.slice(colon + 1).trim();
      if (!value) continue;
      const valueOffset = m.value.indexOf(value);
      if (valueOffset === -1) continue;
      const range = {
        value,
        startIndex: m.startIndex + valueOffset,
        endIndex: m.startIndex + valueOffset + value.length,
      };
      if (/^(?:printemps|[ée]t[ée]|ete|automne|hiver)\s+\d{4}$/i.test(value)) {
        push(range, 'DATE');
      } else if (/^[A-Z]{3,}\d{3,}$/.test(value)) {
        push(range, 'STUDENT_CODE');
      } else {
        push(range, 'ID');
      }
    }

    for (const m of fileNumberRanges) {
      const parts = m.value.split(/[:=]/);
      const tail = parts.length > 1 ? parts[parts.length - 1].trim() : m.value.trim();
      if (!tail) continue;
      const start = m.startIndex + m.value.lastIndexOf(tail);
      push({ value: tail, startIndex: start, endIndex: start + tail.length }, 'FILE_NUMBER');
    }
    for (const m of referenceRanges) {
      const parts = m.value.split(/[:=]/);
      const tail = parts.length > 1 ? parts[parts.length - 1].trim() : m.value.trim();
      if (!tail) continue;
      const start = m.startIndex + m.value.lastIndexOf(tail);
      push({ value: tail, startIndex: start, endIndex: start + tail.length }, 'REFERENCE_ID');
    }
    for (const m of employeeIdRanges) {
      const parts = m.value.split(/[:=]/);
      const tail = parts.length > 1 ? parts[parts.length - 1].trim() : m.value.trim();
      if (!tail) continue;
      const start = m.startIndex + m.value.lastIndexOf(tail);
      push({ value: tail, startIndex: start, endIndex: start + tail.length }, 'EMPLOYEE_ID');
    }

    for (const m of academicPermanentCodeRanges) {
      if (overlapsAny(m, emailRanges) || overlapsAny(m, urlRanges)) continue;
      if (/^(?:\[[A-Z_]+_\d+\]|\{[A-Z_]+_\d+\}|[A-Z_]+_\d+)$/.test(m.value)) continue;
      push(m, 'STUDENT_CODE');
    }
  }

  // ---- Table/list-aware pass (aggressive contextual mode) ----------------
  // Recognizes common "Name / Permanent code" sections and anonymizes
  // the nearby rows even when generic detectors miss them.
  if ((strict || isAcademicLike || isHrLike) && (d.person || d.internalCode)) {
    const lines = text.split(/\r?\n/);
    let cursor = 0;
    let inNameCodeSection = false;
    let sectionTTL = 0;

    for (const rawLine of lines) {
      const line = rawLine;
      const lineStart = cursor;
      cursor += rawLine.length + 1;
      const normalized = line.trim().toLowerCase();

      if (!normalized) {
        if (sectionTTL > 0) sectionTTL -= 1;
        continue;
      }

      const opensSection =
        /^(?:nom|name)\b/.test(normalized) || NAME_SECTION_HINT_REGEX.test(normalized);
      if (opensSection) {
        inNameCodeSection = true;
        sectionTTL = 24;
        continue;
      }

      if (inNameCodeSection) {
        sectionTTL -= 1;
        if (sectionTTL <= 0) {
          inNameCodeSection = false;
          continue;
        }

        // Standalone permanent-code line.
        if (d.internalCode && /^[A-Z]{4}\d{8}$/.test(line.trim())) {
          pushLineMatch(line, lineStart, 'ID');
          continue;
        }

        // Name-like line with at least two alphabetic tokens.
        if (d.person) {
          const candidate = line.trim().replace(/\[[A-Z_]+_\d+\]/g, '').replace(/\s+/g, ' ').trim();
          if (isLikelyPersonName(candidate)) {
            pushLineMatch(line, lineStart, 'PERSON');
            continue;
          }
        }
      }
    }
  }

  for (const m of postalRanges) {
    if (
      overlapsAny(m, addressFrCaFullRanges) ||
      overlapsAny(m, addressFrRanges) ||
      overlapsAny(m, addressEnRanges)
    ) continue;
    push(m, 'POSTAL_CODE');
  }
  for (const m of gpsRanges) push(m, 'GPS_COORDINATES');
  for (const m of locationRanges) push(m, 'LOCATION');
  for (const m of medicalRecordRanges) pushLabelValueOnly(m, 'MEDICAL_RECORD');
  for (const m of medicationRanges) push(m, 'MEDICATION');
  for (const m of healthOrgRanges) push(m, 'HEALTH_ORGANIZATION');
  for (const m of licensePlateRanges) {
    // Le mot-clé fait partie du match ; on n'anonymise que la plaque (fin).
    // NB : garder cette alternation synchronisée avec LICENSE_PLATE_REGEX
    // (formats QC « K23 XPW » et « 123 ABC » inclus).
    const plate = m.value.match(/[A-Z]{2,3}[- ]?\d{3,4}(?:[- ]?[A-Z]{1,2})?$|[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}$|[A-Z]\d{2}[- ]?[A-Z]{3}$|\d{3}[- ]?[A-Z]{3}$/i);
    if (!plate) continue;
    const localIndex = m.value.length - plate[0].length;
    push(
      { value: plate[0], startIndex: m.startIndex + localIndex, endIndex: m.startIndex + localIndex + plate[0].length },
      'LICENSE_PLATE',
    );
  }
  // Plaque française SIV nue (« AB-123-CD ») : la forme à double tiret est assez
  // spécifique pour se passer du libellé exigé par LICENSE_PLATE_REGEX.
  if (d.internalCode) {
    for (const m of findAllMatches(text, LICENSE_PLATE_FR_REGEX)) {
      if (overlapsAny(m, licensePlateRanges)) continue;
      push(m, 'LICENSE_PLATE');
    }
  }
  for (const m of vinRanges) push(m, 'VIN');
  for (const m of cryptoRanges) push(m, 'CRYPTO_WALLET');
  for (const m of insuranceRanges) push(m, 'INSURANCE_POLICY');
  // Forme libellée : seule la valeur (groupe 1) est anonymisée.
  if (d.internalCode) pushCaptureGroup(INSURANCE_POLICY_REGEX, 'INSURANCE_POLICY');

  return detections;
}


// Detect sensitive terms using NER (Named Entity Recognition)
export function detectWithNER(text: string, config: AnonymizerConfig): Detection[] {
  const detections: Detection[] = [];

  const entities = detectEntities(text, {
    persons: config.detectors.person,
    organizations: config.detectors.organization,
  });

  for (const entity of entities) {
    // Filtre de cohérence : compromise émet parfois des tokens tronqués ou mal
    // alignés (ex. "La Sociét" issu de "La Société"). On rejette toute entité
    // dont la portée ne correspond pas exactement au texte source, ou qui tombe
    // en plein milieu d'un mot.
    if (text.slice(entity.startIndex, entity.endIndex) !== entity.value) continue;
    const prevCh = entity.startIndex > 0 ? text[entity.startIndex - 1] : '';
    const nextCh = entity.endIndex < text.length ? text[entity.endIndex] : '';
    if (/\p{L}/u.test(prevCh) || /\p{L}/u.test(nextCh)) continue;

    const valueLower = entity.value.toLowerCase();
    let category: CategoryType = entity.type === 'person' ? 'PERSON' : 'COMPANY';
    // Post-traitement : une « personne » précédée/suivie d'un mot-clé bancaire
    // (banque, caisse, carte, compte, transit, routing) est une institution,
    // pas une personne — reclassée COMPANY (ex. « Transit Desjardins »,
    // « Carte Amex » : le NER prenait la marque pour un patronyme).
    if (category === 'PERSON') {
      const before = text.slice(Math.max(0, entity.startIndex - 20), entity.startIndex);
      if (REGISTRY_LEAD.test(before)) continue;
      const after = text.slice(entity.endIndex, entity.endIndex + 20);
      const bankCtx = /\b(?:banque|bank|caisse|carte|card|compte|account|transit|routing|succursale)\b\s*$/i;
      const bankCtxAfter = /^\s*\b(?:banque|bank|caisse|carte|card|compte|account|transit|routing|succursale)\b/i;
      if (bankCtx.test(before) || bankCtxAfter.test(after)) category = 'COMPANY';
    }
    if (entity.type !== 'person') {
      if (/\b(?:universit[ée]|university|college|coll[eè]ge|institut)\b/i.test(valueLower)) {
        category = 'ORGANIZATION';
      } else if (/\b(?:banque|bank|credit union|caisse)\b/i.test(valueLower)) {
        category = 'BANK_NAME';
      } else {
        category = 'COMPANY';
      }
    }
    detections.push({
      id: generateId(),
      value: entity.value,
      category,
      source: 'ner',
      startIndex: entity.startIndex,
      endIndex: entity.endIndex,
    });
  }

  return detections;
}

// Detect sensitive terms using manual rules
export function detectWithRules(text: string, rules: Rule[]): Detection[] {
  const detections: Detection[] = [];

  for (const rule of rules) {
    const matches = findTermInText(text, rule.term, rule.caseSensitive);
    
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

// Normalise un libellé pour comparaison : minuscules, sans accents, tirets et
// apostrophes -> espace, espaces compactés.
function normalizeNonName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Libellés français administratifs/financiers/de formulaire : des mots communs
// capitalisés, JAMAIS des noms de personnes. On filtre toute détection PERSON
// (regex OU NER) dont la valeur normalisée est l'un d'eux — sinon « Sécurité
// Sociale », « Compte Bancaire », « Solde Actuel », « Limite de Crédit »… sont
// masqués à tort comme des noms. Aucune de ces expressions n'est un patronyme.
const NON_NAME_PHRASES = new Set(
  [
    'securite sociale', 'compte bancaire', 'solde actuel', 'solde disponible',
    'limite de credit', 'carte de credit', 'date de naissance', 'date expiration',
    'date d expiration', 'code de routage', 'assurance maladie', 'numero de compte',
    'nom complet', 'code permanent', 'raison sociale', 'montant total', 'montant du',
    'informations personnelles', 'informations bancaires', 'piece jointe',
    'adresse courriel', 'numero de serie', 'numero de dossier', 'permis de conduire',
    'lieu de naissance', 'etat civil', 'situation familiale', 'code postal',
    'numero de telephone', 'numero de passeport', 'assurance vie', 'assurance auto',
    'securite du revenu', 'revenu net', 'revenu brut', 'salaire net', 'salaire brut',
    'numero de compte bancaire', 'numero de securite sociale',
  ].map(normalizeNonName),
);

function isNonNamePhrase(value: string): boolean {
  return NON_NAME_PHRASES.has(normalizeNonName(value));
}

// Au Canada, un numéro d'entreprise est suivi de son COMPTE DE PROGRAMME :
// « 123456789 RT0001 » (TPS), « … TQ0001 » (TVQ), « … RP0001 » (retenues).
// Selon le détecteur qui gagnait, seuls les 9 chiffres étaient masqués et le
// « RT0001 » restait en clair à côté de l'étiquette. On étend donc toujours la
// détection au compte de programme qui la suit immédiatement.
const PROGRAM_ACCOUNT_TAIL = /^[ \t]?(?:RT|TQ|RP|RC|RM|RZ)[ \t]?\d{4}\b/;
const BUSINESS_ID_CATEGORIES = new Set<CategoryType>([
  'VAT', 'GOV_ID', 'SIREN', 'SIRET', 'COMPANY_ID', 'ID', 'REFERENCE_ID',
]);

function extendProgramAccount(detection: Detection, text: string): Detection {
  if (!BUSINESS_ID_CATEGORIES.has(detection.category)) return detection;
  const tail = text.slice(detection.endIndex).match(PROGRAM_ACCOUNT_TAIL);
  if (!tail) return detection;
  return {
    ...detection,
    value: detection.value + tail[0],
    endIndex: detection.endIndex + tail[0].length,
  };
}

// Detect all sensitive terms
export function detectSensitive(
  text: string,
  config: AnonymizerConfig,
  rules: Rule[] = []
): Detection[] {
  const regexDetections = detectWithRegex(text, config);
  const nerDetections = detectWithNER(text, config);
  const ruleDetections = detectWithRules(text, rules);

  // Combine and remove overlaps (prefer longer matches)
  const allDetections = [...regexDetections, ...nerDetections, ...ruleDetections].filter(
    (d) => !(d.category === 'PERSON' && isNonNamePhrase(d.value)),
  );
  return resolveDetectionsByPriority(allDetections.map((d) => extendProgramAccount(d, text)));
}


// ---- Mapping ------------------------------------------------------------
// The mapping is a value -> placeholder dictionary that can be SHARED across
// several texts, which is what makes anonymizeMany safe (see below).

interface MappingState {
  entries: Map<string, MappingEntry>;
  /**
   * Next index per placeholder LABEL (after alias resolution), never per raw
   * category: SIN and SSN share the label "SIN", and separate counters would
   * hand the same [SIN_1] tag to two different values.
   */
  counters: Record<string, number>;
}

function createMappingState(seed: MappingEntry[] = []): MappingState {
  const state: MappingState = { entries: new Map(), counters: {} };
  for (const entry of seed) {
    const key = entry.original.toLowerCase();
    if (!state.entries.has(key)) state.entries.set(key, { ...entry });
    const label = placeholderLabel(entry.category);
    const m = entry.placeholder.match(/_(\d+)[\]}]?$/);
    const idx = m ? parseInt(m[1], 10) : 0;
    state.counters[label] = Math.max(state.counters[label] ?? 0, idx);
  }
  return state;
}

/** Add these detections to the shared mapping, minting placeholders as needed. */
function registerDetections(
  detections: Detection[],
  placeholderStyle: 'brackets' | 'curly',
  state: MappingState,
): void {
  for (const detection of detections) {
    const key = detection.value.toLowerCase();
    const existing = state.entries.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    const label = placeholderLabel(detection.category);
    state.counters[label] = (state.counters[label] || 0) + 1;
    state.entries.set(key, {
      id: generateId(),
      original: detection.value,
      placeholder: formatPlaceholder(detection.category, state.counters[label], placeholderStyle),
      category: detection.category,
      source: detection.source,
      count: 1,
    });
  }
}

/** Replace right-to-left so earlier indices stay valid. */
function applyDetections(
  text: string,
  detections: Detection[],
  entries: Map<string, MappingEntry>,
): string {
  let out = text;
  for (const detection of sortByPosition(detections).reverse()) {
    const entry = entries.get(detection.value.toLowerCase());
    if (!entry) continue;
    out = out.substring(0, detection.startIndex) + entry.placeholder + out.substring(detection.endIndex);
  }
  return out;
}

/** Detect + resolve overlaps + attach spelling variants of what was found. */
function detectAndResolve(text: string, rules: Rule[], config: AnonymizerConfig): Detection[] {
  let detections = detectSensitive(text, config, rules);
  // Document coherence: a value recognised once often leaks elsewhere under
  // another spelling ("Marc-André Gagnon" -> "MarcAndreGagnon" in a filename).
  // Those occurrences are attached to the canonical value, so they collapse
  // onto the SAME placeholder.
  const coherence = findCoherenceDetections(text, detections);
  if (coherence.length > 0) {
    detections = resolveDetectionsByPriority([...detections, ...coherence]);
  }
  return detections;
}

export function anonymize(
  text: string,
  rules: Rule[],
  config: AnonymizerConfig,
  // Already-established mappings to reuse, so the same value keeps the same tag
  // across a chain of calls. The returned mapping is seed + new, ready to chain.
  seedMapping: MappingEntry[] = [],
): AnonymizationResult {
  const detections = detectAndResolve(text, rules, config);
  const state = createMappingState(seedMapping);
  registerDetections(detections, config.placeholderStyle, state);

  return {
    anonymizedText: applyDetections(text, detections, state.entries),
    mapping: Array.from(state.entries.values()),
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

/**
 * Anonymise several texts against ONE shared mapping, so the same value gets
 * the same placeholder in every text (a prompt and its attachments, a system
 * prompt and a conversation...).
 *
 * Each text is detected and rewritten INDEPENDENTLY. The previous
 * implementation joined the texts with a '\n@@@UMBELI_ANON_SEP@@@\n' sentinel,
 * anonymised the concatenation and split it back apart — with no check that the
 * split produced as many pieces as it was given. Any detection that overlapped
 * or rewrote the sentinel (a strong-secret token, a code block, a caller rule
 * matching the marker, or simply a text that contained the marker itself)
 * silently shifted every subsequent text by one slot, so callers received
 * ANOTHER RECORD'S DATA under their own key. Per-text anonymisation removes the
 * sentinel entirely, so misalignment is structurally impossible; the assertion
 * below states that invariant rather than trusting it.
 */
export function anonymizeMany(
  texts: string[],
  rules: Rule[],
  config: AnonymizerConfig,
): { anonymizedTexts: string[]; mapping: MappingEntry[] } {
  if (!Array.isArray(texts)) throw new TypeError('anonymizeMany: texts must be an array of strings');
  if (texts.length === 0) return { anonymizedTexts: [], mapping: [] };

  const state = createMappingState();
  const anonymizedTexts = texts.map((text, i) => {
    if (typeof text !== 'string') {
      throw new TypeError(`anonymizeMany: texts[${i}] is not a string`);
    }
    const detections = detectAndResolve(text, rules, config);
    registerDetections(detections, config.placeholderStyle, state);
    return applyDetections(text, detections, state.entries);
  });

  if (anonymizedTexts.length !== texts.length) {
    // Unreachable by construction — kept as a loud tripwire rather than letting
    // a future refactor reintroduce silent misalignment between texts.
    throw new Error(
      `anonymizeMany: output/input length mismatch (${anonymizedTexts.length} vs ${texts.length})`,
    );
  }

  return { anonymizedTexts, mapping: Array.from(state.entries.values()) };
}
