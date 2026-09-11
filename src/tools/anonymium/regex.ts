// Ported from Anonymum/src/utils/regex.ts — these patterns are the contract
// between the two engines. Port faithfully; do not "improve" a pattern here
// without porting the same change back to the app.
//
// Two app-side hooks are intentionally absent: the WASM matcher bridge (this
// service always takes the JS path) and the canary watermark patterns.


// Email regex pattern
export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Phone regex patterns (French + international).
// International branch allows parentheses around the area code, e.g.
// "+1 (415) 555-0123", and zero-or-more separator chars between digit
// groups (so "+49 30 12345678" still matches as one number even though
// the trailing chunk has no internal separator).
// Chaque branche exige un SIGNAL de format téléphonique et est bornée par des
// lookarounds de chiffres (?<!\d)/(?!\d) — jamais \b, qui laissait matcher au
// milieu d'un nombre plus long (NIR compact, IMSI, numéro de chèque) :
//  - FR : préfixe +33 ou 0 initial (le 0 EST le signal ; « 0612345678 » nu reste
//    un téléphone) ;
//  - international : préfixe + obligatoire ;
//  - nord-américain : parenthèses (514) OU séparateurs aux DEUX positions
//    OU préfixe +1 explicite. Une suite de 10-11 chiffres nus n'est PAS un
//    téléphone (NPI, RPPS, titre de séjour, comptes… ont leurs détecteurs).
// --- Branche FRANCE ------------------------------------------------------
// Un numéro français s'écrit de dix façons dans un même document : collé,
// espacé par 2, par 3, avec des points, des tirets, des slashs, précédé de
// +33, de 0033, avec ou sans le « (0) » de courtoisie. On couvre les trois
// préfixes possibles × les deux groupements usuels plutôt qu'un seul format.
//  - séparateurs : espace (insécable compris), point, tiret, slash ;
//  - groupement 2-2-2-2 (« 06 12 34 56 78 ») ET 3-3-3 (numéros spéciaux
//    « 0 800 123 456 ») ;
//  - le 0 de tête peut être détaché sur les numéros spéciaux uniquement — le
//    généraliser ferait passer « 0 123 456 789 » (un compte) pour un téléphone.
const FR_SEP = `[\\s.\\-/]`;
const FR_NSN = `[1-9](?:${FR_SEP}?\\d{2}){4}|[1-9]\\d{2}${FR_SEP}?\\d{3}${FR_SEP}?\\d{3}`;
export const PHONE_FR_REGEX = new RegExp(
  `(?<!\\d)(?:` +
    `(?:\\+33|00${FR_SEP}?33)${FR_SEP}{0,2}(?:\\(0\\))?${FR_SEP}{0,2}(?:${FR_NSN})` +
    `|0(?:${FR_NSN})` +
    `|0${FR_SEP}8\\d{2}${FR_SEP}?\\d{3}${FR_SEP}?\\d{3}` +
  `)(?!\\d)`,
  'g',
);

// Numéro court français (3939, 3949, 118 712…). Toujours étiqueté : un nombre
// de 4 chiffres nu est bien trop courant pour être présumé téléphonique.
export const PHONE_SHORT_FR_REGEX =
  /\b(?:t[ée]l(?:[ée]phone)?|appelez\s+le|appeler\s+le|composez\s+le|joignable\s+au|num[ée]ro\s+court|serveur\s+vocal)\s*:?\s*(3\d{3}|10\d{2}|118[ ]?\d{3})(?!\d)/gi;

export const PHONE_REGEX = new RegExp(
  `${PHONE_FR_REGEX.source}|` +
  `(?<!\\d)\\+\\d{1,3}[\\s.()-]{0,4}\\d{1,4}(?:[\\s.()-]{0,4}\\d{1,4}){2,4}(?!\\d)|` +
  `(?<!\\d)(?:(?:\\+?1[\\s.-]?)?\\(\\d{3}\\)[\\s.-]?\\d{3}[\\s.-]?\\d{4}|(?:\\+?1[\\s.-])?\\d{3}[\\s.-]\\d{3}[\\s.-]\\d{4}|\\+1\\d{10})(?:\\s*(?:poste|ext\\.?|x)\\s*\\d{1,5})?(?!\\d)`,
  'g',
);

// Price regex
// (?!\w) is used instead of \b after a currency symbol/letter so that Unicode
// symbols like € (which aren't \w) are still terminated correctly.
// Thousand separators include space, dot, and comma.
// Les FOURCHETTES passent en premier : une alternative plus courte gagnerait
// sinon la course et ne masquerait que la borne portant la devise.
// « CA$12.34 », « US$5 », « C$10 » : le préfixe de pays fait partie du montant —
// sans lui dans la boîte, « CA » restait à nu devant chaque prix caviardé.
export const PRICE_REGEX = /(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?\s*(?:à|–|—|-|et|to)\s*(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?\s?(?:€|(?:CA|US|AU|NZ|HK|SG|C|U)?\$|£|EUR|USD|CAD|GBP|CHF)(?!\w)|\b(?:EUR|USD|CAD|GBP|CHF)\s?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?\s*(?:à|–|—|-|et|to)\s*(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?(?!\w)|(?:€|(?:CA|US|AU|NZ|HK|SG|C|U)?\$|£)\s?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?\s*(?:à|–|—|-|et|to)\s*(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?(?!\w)|\b(?:EUR|USD|CAD|GBP|CHF)\s?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?(?!\w)|(?:€|(?:CA|US|AU|NZ|HK|SG|C|U)?\$|£)\s?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?(?!\w)|(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{2})?\s?(?:€|(?:CA|US|AU|NZ|HK|SG|C|U)?\$|£|EUR|USD|CAD|GBP|CHF)(?!\w)|\$\s?\d+(?:\.\d+)?[kKmMbB](?!\w)/g;

export const IBAN_REGEX = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}(?![A-Za-z0-9])/g;

export const BIC_REGEX = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;

export const URL_REGEX = /https?:\/\/[^\s)]+/g;

export const HANDLE_REGEX = /@[a-zA-Z0-9._-]{2,}/g;

// French-format date: dd/mm/yyyy or dd/mm/yy
export const DATE_FR_REGEX = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

// French textual date: "14 mars 2026", "5 mai 2026", "1er janvier 2024".
// (?<!\d) au lieu de \b en tête : un libellé collé (« Naissance14 mars 1987 »,
// cellule de tableau fusionnée) ne doit pas empêcher la détection de la date.
export const DATE_FR_LONG_REGEX = /(?<!\d)\d{1,2}(?:er|e|ème)?\s+(?:janvier|f[ée]vrier|fevrier|mars|avril|mai|juin|juillet|ao[ûu]t|aout|septembre|octobre|novembre|d[ée]cembre|decembre)\s+\d{2,4}\b/gi;

// ISO date: yyyy-mm-dd
export const DATE_ISO_REGEX = /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;

// Horodatage ISO 8601 complet (« 2026-08-14T09:14:22.118Z »). DATE_ISO_REGEX ne
// le couvre pas : son \b final échoue devant le « T ». Résultat, HOST_PORT_REGEX
// s'en emparait — « 2026-08-14T09 » contient une lettre, donc passe pour un nom
// d'hôte, et « :14 » pour un port — et le rendait en « [HOST_1]:22.118Z ».
export const ISO_DATETIME_REGEX =
  /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?/g;

// English-format date: "November 28, 2024", "Nov 28th, 2024", "March 15 1987"
export const DATE_EN_REGEX = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/gi;

// Date-of-birth phrases (FR + EN) — captures the full prefix + date so the
// "born" / "né le" context disappears with the date itself.
export const DOB_REGEX = /\b(?:born|n[ée]e?\s+le)\s+(?:\d{1,2}\s+(?:janvier|f[ée]vrier|fevrier|mars|avril|mai|juin|juillet|ao[ûu]t|aout|septembre|octobre|novembre|d[ée]cembre|decembre)\s+\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4})\b/gi;

// French address: "12 rue de la Paix, 75002 Paris" ou
// "14 bis, rue de la République, Bât. C, 3e étage, 69002 Lyon".
// bis/ter/quater (avec virgule optionnelle), types de voie élargis (quai,
// cours), éléments intermédiaires optionnels (Bât. X, Ne étage, appt N,
// escalier) entre la voie et le code postal.
export const ADDRESS_FR_REGEX =
  /\b\d{1,4}(?:\s+(?:bis|ter|quater))?,?\s+(?:rue|avenue|av\.?|boulevard|bd|chemin|impasse|place|all[ée]e|route|quai|cours)\s+[^\n,]+?(?:,\s*(?:b[âa]t(?:iment)?\.?\s*[A-Z0-9]+|\d{1,2}e?r?\s+[ée]tage|appt?\.?\s*\d+[A-Za-z]?|escalier\s*[A-Z0-9]+)){0,3},\s*\d{5}\s+[A-Za-zÀ-ÖØ-öø-ÿ' -]+(?![A-Za-zÀ-ÖØ-öø-ÿ])/gi;

// Code postal français + ville connue, hors adresse complète (« 69002 Lyon »
// isolé). Gazetteer des grandes villes pour ne pas confondre 5 chiffres
// quelconques (ou un ZIP US) avec un code postal FR.
export const POSTAL_FR_CITY_REGEX =
  /(?<!\d)\d{5}\s+(?:Paris|Lyon|Marseille|Toulouse|Nice|Nantes|Montpellier|Strasbourg|Bordeaux|Lille|Rennes|Reims|Toulon|Grenoble|Dijon|Angers|N[îi]mes|Clermont-Ferrand|Le\s+Mans|Aix-en-Provence|Brest|Tours|Amiens|Limoges|Annecy|Perpignan|Besan[çc]on|Metz|Orl[ée]ans|Rouen|Nancy|Caen|Avignon|Saint-[ÉE]tienne|Villeurbanne)(?![A-Za-zÀ-ÖØ-öø-ÿ])/g;

// ZIP US précédé d'un code d'État (« , NY 10118 », « , TX 75201-1234 ») hors
// adresse complète — on ne masque que le ZIP (groupe 1).
export const STATE_ZIP_US_REGEX = /,\s*[A-Z]{2}\s+(\d{5}(?:-\d{4})?)(?!\d)/g;
// Adresse québécoise complète. Couvre plusieurs formats courants :
//   "1245 rue des Érables, appartement 302, Trois-Rivières, Québec, G8Z 2M4"
//   "1247, rue des Peupliers, bureau 305\nSherbrooke (Québec) J1H 4M2"
//   "4582 Rue des Érables, App. 4B, Montréal, QC, H2J 2K9"
// Donc : virgule optionnelle après le numéro civique, séparateur virgule OU
// saut de ligne entre la rue et la ville, province avec ou sans parenthèses,
// et espace ou virgule avant le code postal. Le complément d'adresse accepte
// les abréviations (App. / Apt / Bur. …), un point, un « n° » / « # » et une
// unité alphanumérique (4B). Les espacements internes aux noms (rue, ville)
// sont limités à [ \t] pour ne pas « manger » la ligne suivante.
export const ADDRESS_FR_CA_FULL_REGEX =
  /\b\d{1,5}(?:[-–]\d{1,5})?,?[ \t]+(?:rue|avenue|av\.?|boulevard|boul\.?|bd|chemin|ch\.?|impasse|place|all[ée]e|route|mont[ée]e|c[ôo]te)[ \t]+[A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[ \t]+[A-Za-zÀ-ÖØ-öø-ÿ'’-]+)*(?:,[ \t]*(?:appartement|appart|appt|apt|app|bureau|bur|suite|unit[ée]|local|porte)\.?[ \t]*(?:n[o°º]\.?[ \t]*|#[ \t]*)?\d+[A-Za-z]?)?(?:,[ \t]*|[ \t]*\n[ \t]*)[A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[ \t]+[A-Za-zÀ-ÖØ-öø-ÿ'’-]+)*(?:,[ \t]*|[ \t]+)\(?(?:Qu[ée]bec|QC|Ontario|ON)\)?(?:,[ \t]*|[ \t]+)[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;

// Adresse « rue seule » : numéro + type de voie (avec abréviations QC : boul.,
// av., ch.) + nom de voie capitalisé, sans exiger ville/province/code postal —
// couvre « 2900 boul. des Forges » ou « 1450 boul. Gene-H.-Kruger » qui
// fuyaient intégralement. Une ville en apposition (« , Trois-Rivières ») est
// avalée si présente. Les adresses complètes gagnent par résolution de
// chevauchement (match plus long, même priorité).
export const ADDRESS_STREET_FR_REGEX =
  /\b\d{1,5}(?:[-–]\d{1,5})?,?[ \t]+(?:rue|avenue|av\.?|boulevard|boul\.?|bd|chemin|ch\.?|impasse|place|all[ée]e|route|mont[ée]e|c[ôo]te|terrasse|croissant)[ \t]+(?:(?:de[ \t]+la|de[ \t]+l['’]|d['’]|l['’]|du|des|de|le|la)[ \t]*)?[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*(?:[ \t]+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*)*(?:,[ \t]*(?:appartement|appart|appt|apt|app|bureau|bur|suite|unit[ée]|local|porte)\.?[ \t]*(?:n[o°º]\.?[ \t]*|#[ \t]*)?\d+[A-Za-z]?)?(?:,[ \t]*[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]*(?:[ \t][A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]*)*)?/g;


// Ligne « ville + province + code postal » d'un en-tête de facture, SANS rue :
//   « L'Assomption QC J5W 1N5 », « Montréal (Québec) H3B 4W8 »
// Seul le code postal était masqué ; la ville restait en clair, ou pire, le
// NER la prenait pour une personne (« rue de l'[PERSON_49] »).
export const CITY_PROVINCE_POSTAL_CA_REGEX =
  /\b[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*(?:[ \t]+(?:de|des|du|la|le|aux?)[ \t]+)?(?:[ \t]+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*)*(?:,[ \t]*|[ \t]+)\(?(?:Qu[ée]bec|QC|Ontario|ON|Alberta|AB|Manitoba|MB|Saskatchewan|SK|Nouveau-Brunswick|NB|Nouvelle-[ÉE]cosse|NS|Terre-Neuve(?:-et-Labrador)?|NL|Colombie-Britannique|BC|Yukon|YT|Nunavut|NU)\)?(?:,[ \t]*|[ \t]+)[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/g;

// Raison sociale terminée par une forme juridique (« Agence Bertrand inc. »).
// compromise ne rendait que « Bertrand inc » et laissait « Agence » en clair.
// Casse SENSIBLE sur les mots qui précèdent (pas de drapeau `i`) : avec `i`,
// « [A-Z] » aurait avalé des mots en minuscules et mangé des phrases entières.
export const ORG_LEGAL_SUFFIX_REGEX =
  /\b(?:[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ0-9'’&.-]*[ \t]+){1,4}(?:[Ii]nc|INC|[Ll]t[ée]e|LT[ÉE]E|[Ll]td|LTD|LLC|[Cc]orp|CORP|SENCRL|SENC|SARL|SAS|GmbH)\b\.?/g;

// Le document ressemble-t-il à une facture / un devis ? Garde du détecteur de
// montants nus ci-dessous, qui serait trop large sur un texte quelconque.
export const INVOICE_HINT_REGEX =
  /\b(?:facture|invoice|devis|soumission|quote|re[çc]u|receipt|sous-total|subtotal|solde\s+[àa]\s+payer|balance\s+due|total\s+partiel|montant\s+total|tps|tvq|tvh|gst|qst|hst)\b/i;

// Montant SANS symbole ni code de devise (« 1 034,78 », « 900,00 ») : dans une
// facture, les colonnes de totaux n'écrivent le « $ » qu'une fois, voire
// jamais. Deux décimales EXIGÉES, et rien d'autre autour (ni chiffre, ni
// séparateur, ni « % ») pour ne pas mordre sur un taux (« 9,975 % »), une
// version (« 4.2.1 ») ou une date. Le nombre ne doit toucher ni lettre ni
// barre oblique, sinon « AppleWebKit/537.36 » passait pour un montant.
// Réservé aux documents de facturation.
export const BARE_AMOUNT_REGEX =
  /(?<![\d.,/\p{L}])\d{1,3}(?:[ \u00A0]\d{3})*[.,]\d{2}(?![\d.,%\p{L}])/gu;

// Poste téléphonique interne mentionné seul (« appelle-moi au poste 4471 ») —
// le PHONE_REGEX ne gère l'extension que collée à un numéro complet.
export const PHONE_EXT_REGEX = /\b(?:poste|extension|ext\.?)\s*[:#]?\s*(\d{2,5})\b/gi;

// Permis professionnel avec acronyme d'ordre (« permis CMQ 1-23456 ») ou
// marqueur (« permis no 12345 »). L'acronyme OU le marqueur est REQUIS pour ne
// pas attraper « permis 2026 » (une année). Le permis de conduire est géré par
// DRIVER_LICENSE_REGEX.
export const PRO_PERMIT_REGEX =
  /\b[Pp]ermis\s+(?:[A-Z]{2,6}\s+(?:n[o°º]\.?\s*)?|n[o°º]\.?\s*|#\s*)([A-Z]{0,2}\d[\d -]{2,12}\d|[A-Z]{1,2}\d{3,8})\b/g;

// Numéro de facture ou de chèque (« facture 00347 », « chèque no 004521 »,
// « Invoice Number: 15249172343 ») — exclut une année seule. La valeur admet
// une suite composée espaces/tirets (« 001 815-30204 0987654 » : ligne MICR
// complète d'un chèque) pour ne pas n'en masquer que le premier segment.
//
// Seconde famille, plus large (commande, événement, billet, réservation,
// confirmation, reçu — pas « compte » ni « client », qui ont leurs propres
// détecteurs bancaire et CLIENT) : elle EXIGE un marqueur (« number »,
// « n° », « : », « # ») avant la valeur — « commande 3 articles » ou
// « billet 150 $ » ne doivent pas y passer, « Event: 1989612762331 » si.
export const INVOICE_REGEX =
  /\b(?:(?:facture|invoice|ch[èe]que|cheque)(?:\s+(?:number|num[ée]ro|no|id|ref))?\s*(?:n[o°º]\.?\s*)?[:#]?|(?:order|commande|event|[ée]v[ée]nement|ticket|billet|booking|r[ée]servation|confirmation|receipt|re[çc]u)(?:\s+(?:number|num[ée]ro|no|id|code|ref(?:erence)?)\s*(?:n[o°º]\.?\s*)?[:#]?|\s*(?:n[o°º]\.?|[:#])))\s*(?!(?:19|20)\d{2}\b)(\d[\d -]{2,24}\d|\d{3,10})(?!\d)/gi;

// Lot cadastral québécois (« lot 3 456 789 du cadastre ») — chiffres groupés
// par espaces, ≥ 6 caractères pour éviter « lot 3 » en prose.
export const LOT_CADASTRAL_REGEX = /\b[Ll]ot\s+(\d[\d ]{4,9}\d)\b/g;

// ---- Identifiants à CONTEXTE LEXICAL (mot-clé à gauche, rayon ~30 chars) ----
// Le contexte prime sur la forme brute : un nombre nu de 9-15 chiffres n'est
// jamais tagué sans son mot-clé. On n'anonymise que la valeur (groupe 1).
// Santé / professionnels
export const NPI_CTX_REGEX = /\bNPI[^\n\d]{0,20}(\d{10})(?!\d)/gi;
export const RPPS_CTX_REGEX = /\bRPPS[^\n\d]{0,20}(\d{11})(?!\d)/gi;
export const ADELI_CTX_REGEX = /\bADELI[^\n\d]{0,20}(\d{9})(?!\d)/gi;
export const DEA_CTX_REGEX = /\bDEA[^\n\d]{0,20}\b([A-Z]{2}\d{7})(?!\d)/g;
export const PHN_BC_CTX_REGEX = /\b(?:PHN|personal\s+health\s+number|num[ée]ro\s+de\s+sant[ée])[^\n\d]{0,40}(9\d{3}[ -]?\d{3}[ -]?\d{3})(?!\d)/gi;
// Immigration / citoyenneté
export const SEJOUR_CTX_REGEX = /\b(?:titre|carte)\s+de\s+s[ée]jour[^\n\d]{0,25}(\d{9,10})(?!\d)/gi;
export const PR_CARD_CTX_REGEX = /\b(?:r[ée]sident\s+permanent|permanent\s+resident|carte\s+RP|PR\s+card)[^\n\d]{0,30}(\d{4}-\d{4})(?!\d)/gi;
export const CITIZENSHIP_CTX_REGEX = /\b(?:citoyennet[ée]|citizenship)[^\n\d]{0,30}\b([A-Z]\d{7})(?!\d)/gi;
// Fiscal / gouvernement
export const SSN_CTX_REGEX = /\b(?:SSN|social\s+security)[^\n\d]{0,20}(\d{9})(?!\d)/gi;
export const ABA_ROUTING_CTX_REGEX = /\b(?:routing|ABA)[^\n\d]{0,20}(\d{9})(?!\d)/gi;
export const EIN_CTX_REGEX = /\b(?:EIN|employer\s+identification)[^\n\d]{0,20}(\d{2}-\d{7})(?!\d)/gi;
export const CNI_CTX_REGEX = /\b(?:CNI|carte\s+nationale\s+d['’]identit[ée])[^\n\d]{0,25}\b(\d{12}|(?=[A-Z0-9]*\d)[A-Z0-9]{9})(?![A-Za-z0-9])/g;
export const CAF_CTX_REGEX = /\b(?:CAF|P[ôo]le\s+emploi|France\s+Travail|allocataire)[^\n\d]{0,25}\b(\d{7}[A-Z]?)(?![A-Za-z0-9])/g;
export const AVIS_IMPOT_CTX_REGEX = /\b(?:avis\s+d['’]imposition|num[ée]ro\s+fiscal|r[ée]f[ée]rence\s+de\s+l['’]avis)[^\n\d]{0,25}(\d[\d ]{9,17}\d)(?!\d)/gi;
// Télécom / appareils — IMEI aussi détectable SANS contexte si Luhn valide
// (géré côté moteur) ; IMSI exige le mot-clé.
export const IMEI_CTX_REGEX = /\bIMEI[^\n\d]{0,20}(\d{15})(?!\d)/gi;
export const IMSI_CTX_REGEX = /\bIMSI[^\n\d]{0,20}(\d{15})(?!\d)/gi;
export const BARE_15_DIGITS_REGEX = /(?<!\d)\d{15}(?!\d)/g;
// Voyage / accès
export const PNR_CTX_REGEX = /\b(?:vol|flight|r[ée]servation|booking|PNR)[^\n]{0,30}?\b((?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6})\b/g;
// \b après le groupe de mots-clés : sinon « porte » matchait le préfixe de
// « porteur » et volait les chiffres qui suivaient.
// « porte » NU a été retiré : c'est d'abord un verbe (« sa carte Vitale porte
// le 8000 1234… »), et il faisait passer le début d'un numéro de carte pour un
// code d'accès — donc pour un mot de passe, catégorie bien plus prioritaire.
export const ACCESS_CODE_CTX_REGEX = /\b(?:code\s+(?:d['’]acc[èe]s|de\s+porte|d['’]entr[ée]e)|digicode|door\s+code)\b[^\n\d]{0,15}(\d{4,8}#?)(?!\d)/gi;
// Username Active Directory nu (DOMAINE\utilisateur) — la forme backslash est
// assez distinctive pour se passer de libellé.
export const AD_USERNAME_REGEX = /\b[A-Za-z][A-Za-z0-9_-]{1,15}\\[A-Za-z][A-Za-z0-9._-]{2,}\b/g;
// Coordonnées GPS au format DMS : 45°30'15.5"N, 73°33'20.1"W (paire ou seule).
export const GPS_DMS_REGEX =
  /\d{1,3}\s?°\s?\d{1,2}\s?['’′]\s?\d{1,2}(?:[.,]\d+)?\s?["”″]\s?[NSEOW](?:[,\s]+\d{1,3}\s?°\s?\d{1,2}\s?['’′]\s?\d{1,2}(?:[.,]\d+)?\s?["”″]\s?[NSEOW])?/g;

// English-style address: "350 Fifth Ave, New York, NY 10118" or
// "221B Baker Street, London". Number (with optional letter), then a
// capitalized street name, then a street type, then comma-separated
// city, with optional state + ZIP.
export const ADDRESS_EN_REGEX = /\b\d{1,5}[A-Z]?\s+(?:[A-Z][a-zA-Z]+\s+){1,4}(?:Avenue|Ave|Street|St|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Plaza|Place|Pl|Court|Ct|Square|Sq|Highway|Hwy)\.?,\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}(?:,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?\b/g;

// US ZIP-code phrase: "ZIP 94103" or "Zipcode 12345"
export const ZIP_US_REGEX = /\bZIP(?:code)?\s+\d{5}(?:-\d{4})?\b/gi;

// Credit card numbers — Visa, Mastercard, Amex, Discover, plus a generic
// 13-19-digit fallback (covers Diners, JCB, UnionPay, etc.). Allows space
// or dash separators.
export const CREDIT_CARD_REGEX = /(?<!\d)(?:4\d{3}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|5[1-5]\d{2}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|6(?:011|5\d{2}|22\d)[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|3[47]\d{2}[ -]?\d{6}[ -]?\d{5}|(?:\d{4}[ -]){3}\d{4})(?!\d)/g;

// CVV in context: "CVV: 123", "CVC 1234"
export const CVV_REGEX = /\b(?:CVV|CVC|CV2|CCV)\s*:?\s*\d{3,4}\b/gi;

// Card expiry: "exp 12/27", "expires 12/27", "expiry: 12-27", "12/2027"
export const EXPIRY_REGEX = /\b(?:exp(?:iry|ires?)?|expiration)\s*:?\s*(?:0[1-9]|1[0-2])[/-](?:\d{2}|\d{4})\b/gi;

// French RIB: "Banque: 30004, Guichet: 00170, Compte: 00012345678, Cle: 67"
export const RIB_REGEX = /\bBanque\s*:\s*\d{5}\s*,\s*Guichet\s*:\s*\d{5}\s*,\s*Compte\s*:\s*\d{8,11}\s*,\s*Cl[eé]\s*:\s*\d{2}\b/gi;

// French national IDs
// NIR (FR social security): 13 + 2 control = 15 digits, often spaced.
// Format: 1|2 yy mm dd PPP NNN cc (where dd may be 2A/2B for Corsica).
// Séparateurs optionnels : couvre le NIR espacé (« 2 85 09 69 123 456 78 »)
// ET compact (« 285096912345678 »). Lookarounds de chiffres, pas de \b.
// Le mois n'est pas borné à 01-12 : l'INSEE utilise 20-42 (mois inconnu) et
// 50-99 (personnes nées à l'étranger, procédures particulières) — s'en tenir à
// 01-12 laissait fuiter des NIR parfaitement réels. Le département accepte la
// Corse (2A/2B) et les codes 97/98/99 (DOM-TOM et naissances hors de France).
export const NIR_REGEX = /(?<!\d)[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}(?!\d)/g;

// NIR étiqueté, y compris sans sa clé de contrôle (13 chiffres) : les fiches de
// paie et les dossiers CPAM l'écrivent souvent tronqué.
export const NIR_CTX_REGEX =
  /\b(?:NIR|num[ée]ro\s+de\s+s[ée]curit[ée]\s+sociale|s[ée]curit[ée]\s+sociale|num[ée]ro\s+INSEE|carte\s+vitale|assur[ée]\s+social)[^\n\d]{0,25}([12][\d ]{11,18}\d)(?!\d)/gi;

// SIRET séparé (3-3-3-5). Le séparateur reste OBLIGATOIRE ici — sans lui, la
// regex matcherait n'importe quelle suite de 14 chiffres. Le point et le tiret
// s'ajoutent à l'espace ; la forme compacte « 55210055400041 » est prise en
// charge par fr-identifiers.ts, sous validation de la clé de Luhn.
export const SIRET_REGEX = /(?<!\d)\d{3}[\s.-]\d{3}[\s.-]\d{3}[\s.-]?\d{5}(?!\d)/g;

// SIREN (9 digits, spaced 3-3-3) — also matches Canadian SIN format.
export const SIREN_REGEX = /(?<!\d)\d{3}[\s-]\d{3}[\s-]\d{3}(?!\d)/g;

// Plaque d'immatriculation française SIV (depuis 2009) : « AB-123-CD ». Le
// tiret est obligatoire pour rester très spécifique ; la forme espacée ou
// collée reste couverte par LICENSE_PLATE_REGEX (avec son libellé).
export const LICENSE_PLATE_FR_REGEX = /(?<![A-Z0-9-])[A-Z]{2}-\d{3}-[A-Z]{2}(?![A-Z0-9-])/g;

// Intra-community VAT: country code + check digits + national number.
// Covers FR + most EU formats (FR12345678901, DE123456789, GB123456789, etc.).
// Frontière de tête EXPLICITE et non `\b` : les lettres accentuées sont des
// non-mots pour \b, qui ouvrait donc une frontière au milieu de « numéro » —
// « …numéro 552100554 » était lu comme une TVA roumaine « RO 552100554 ».
// PAS de drapeau /i sur le code pays : un numéro de TVA intracommunautaire
// s'écrit en capitales, et sous /i le mot français le plus courant — « de » —
// devenait un préfixe allemand. « La facture est de 34567890 centimes »
// partait ainsi en numéro de TVA. Le reste du motif est inchangé.
export const VAT_REGEX = /(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9])(?:AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|GR|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|GB)\s?\d{2,3}\s?\d{6,12}(?![A-Za-z0-9])/g;

// US Social Security Number: 3-2-4 digits with hyphens.
export const SSN_US_REGEX = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g;

// Adjective / connective words allowed between the keyword and the ID
// (e.g., "passeport britannique GB...", "son permis est le B...").
const ID_QUALIFIER = `(?:\\s+(?:britannique|am[eé]ricain(?:e)?|fran[çc]ais(?:e)?|allemand(?:e)?|italien(?:ne)?|espagnol(?:e)?|europ[eé]en(?:ne)?|canadien(?:ne)?|US|UK|FR|DE|IT|ES|EU|CA|number|num[eé]ro|n[°ºo]\\.?|de\\s+conduire|est\\s+le|est\\s+la|est|le|la))*`;

// Passport (FR/EN): keyword followed by adjectives/connectives, then an
// alphanumeric ID. The scoped lookahead `(?=[A-Z0-9-]*\d)` prevents the
// regex from satisfying itself with a literal "passport" word (which is
// 8 alphanumeric chars and would otherwise match the ID slot).
export const PASSPORT_REGEX = new RegExp(
  `\\b(?:passport|passeport)${ID_QUALIFIER}\\s*:?\\s*(?=[A-Z0-9-]*\\d)[A-Z0-9](?:[A-Z0-9-]{4,18}[A-Z0-9])?\\b`,
  'gi',
);

// Driver's license: FR "permis", EN "driver's license/licence". Same
// connective-word and scoped-lookahead trick as passport.
export const DRIVER_LICENSE_REGEX = new RegExp(
  `\\b(?:permis|driver'?s?\\s+licen[cs]e|DL)${ID_QUALIFIER}\\s*:?\\s*(?=[A-Z0-9-]*\\d)[A-Z0-9](?:[A-Z0-9-]{4,20}[A-Z0-9])?\\b`,
  'gi',
);
export const HEALTH_CARD_REGEX = /\b[A-Z]{4}\s?\d{4}\s?\d{4}\b/g;

// IPv4
export const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\b/g;

// IPv6 — forme complète ET formes compressées (::), ex. "2001:db8::1".
export const IPV6_REGEX =
  /\b(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|[A-Fa-f0-9]{1,4}:(?::[A-Fa-f0-9]{1,4}){1,6}|(?:[A-Fa-f0-9]{1,4}:){1,7}:)\b/g;

// MAC address (colon or hyphen separated)
export const MAC_REGEX = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;

// API keys and tokens — explicit prefixes so we don't false-positive on
// generic alphanumeric strings.
export const API_KEY_REGEX = /\b(?:sk-ant-(?:api\d+-)?[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[opsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g;

// JWT (three base64url segments, header starts with `eyJ`)
export const JWT_REGEX = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

// Bearer token in Authorization-header style.
export const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9_.\-+/=]{8,}\b/g;

// AWS secret access key (40 caractères base64) — détecté en contexte pour éviter
// les faux positifs sur du base64 quelconque.
export const AWS_SECRET_REGEX =
  /\b(?:aws_secret_access_key|aws_secret_key|aws_secret|secret_access_key)\s*[:=]\s*["'`]?[A-Za-z0-9/+=]{40}["'`]?/gi;

// Bloc de clé privée PEM (RSA/EC/DSA/OPENSSH/PGP), bloc complet si fermé.
export const PRIVATE_KEY_REGEX =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

// Password line: "password: hunter2", "mot de passe = ...", "mdp: ..."
export const PASSWORD_LINE_REGEX = /\b(?:password|passwd|pwd|mot\s+de\s+passe|mdp)(?:\s+[a-zà-öø-ÿ_-]{2,20}){0,3}\s*[:=]\s*\S+/gi;

// Jeton « en forme de mot de passe » SANS libellé adjacent : ≥ 8 caractères,
// majuscule + minuscule + chiffre + caractère spécial (!#$%^&*?+=~) suivi d'un
// alphanumérique (un « ! » final de phrase ne compte pas). Attrape les mots de
// passe mentionnés en prose (« Le temporaire est : Hiver2026!Tremblay ») que
// PASSWORD_LINE_REGEX rate faute de mot-clé sur le segment. Sur-rédaction
// possible mais rare : un mot CamelCase+chiffres+spécial au milieu est presque
// toujours un secret.
// Premier caractère alphanumérique requis : « #992-BDate » (marqueur de numéro,
// pas un secret) ne doit pas matcher — sinon il volait le numéro de projet.
export const PASSWORD_STRONG_TOKEN_REGEX =
  /(?<![A-Za-z0-9!#$%^&*?+=~._@\\/-])(?=[A-Za-z0-9])(?=[^\s]*[A-Z])(?=[^\s]*[a-z])(?=[^\s]*\d)(?=[^\s]*[!#$%^&*?+=~][A-Za-z0-9])[A-Za-z0-9!#$%^&*?+=~._-]{8,64}(?![A-Za-z0-9!#$%^&*?+=~@\\/-])/g;

// Inline user credential pair where the secret is not explicitly labelled:
// e.g. `User : "EMAIL_1" : ’’79petd32’’`
export const USER_SECRET_INLINE_REGEX =
  /\b(?:user|username|login|identifiant)\b[^\n:]{0,30}:\s*["'“”‘’`]*[A-Za-z0-9._%+-@]+["'“”‘’`]*\s*:\s*["'“”‘’`]*[A-Za-z0-9!@#$%^&*._-]{6,}["'“”‘’`]*/gi;

// La valeur accepte le backslash (format Windows/AD « domaine\utilisateur »).
export const USERNAME_LINE_REGEX =
  /\b(?:nom\s*d['’]utilisateur|username|user(?:name)?|identifiant|login)\s*[:=]\s*["'“”‘’`]*[A-Za-z0-9._@\\-]{3,}["'“”‘’`]*/gi;

export const SESSION_ID_REGEX =
  /\b(?:session(?:[_\s-]?id)?|token\s+de\s+session)\s*[:=]\s*["'“”‘’`]*[A-Za-z0-9._-]{8,}["'“”‘’`]*/gi;
// Codes OTP / 2FA / vérification — label-gated. On exige un libellé explicite
// (code de vérification / sécurité / authentification, OTP, 2FA, one-time…) suivi
// des chiffres (3 à 8, éventuellement groupés « 884 291 », « 482913 », « 1234 »).
// Sans libellé on ne capture pas : un nombre nu n'est pas forcément un OTP.
// pushLabelValueOnly garde le libellé lisible et n'anonymise que la valeur.
export const OTP_CODE_REGEX =
  /\b(?:code\s+(?:de\s+)?v[ée]rification(?:\s+temporaire)?|code\s+(?:de\s+)?s[ée]curit[ée]|code\s+d['’]?\s*authentification|code\s+(?:de\s+)?confirmation|code\s+temporaire|code\s+[àa]\s+usage\s+unique|code\s+(?:otp|2fa)|verification\s+code|security\s+code|authentication\s+code|confirmation\s+code|temporary\s+code|one[-\s]?time\s+(?:password|code|pin)|two[-\s]?factor\s+(?:authentication\s+)?code|passcode|2fa(?:\s+code)?|otp(?:\s+code)?)\s*(?:[:=]|\b(?:est|is)\b)?\s*(\d{4,8}|\d{2,4}(?:[ -]\d{2,4}){1,3})/gi;
export const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
export const CSRF_TOKEN_REGEX = /\b(?:csrf(?:[_-]?token)?)\s*[:=]\s*[A-Za-z0-9._-]{8,}\b/gi;
export const TRANSACTION_ID_REGEX = /\b(?:txn|transaction(?:[_\s-]?id)?|request(?:[_\s-]?id)?)\s*[:=]\s*[A-Za-z0-9._-]{6,}\b/gi;

// Le `(?=[A-Za-z0-9._-]*\d)` exige au moins un chiffre dans la valeur : sans
// lui, le flag `i` laisse `[A-Z0-9]` matcher des mots en minuscules (ex.
// "dossier est suivi" -> faux FILE_NUMBER). Les vrais identifiants ont un chiffre.
export const FILE_NUMBER_REGEX =
  /\b(?:num[ée]ro\s+de\s+dossier|dossier|file\s*(?:number|no))(?:\s+\w+){0,3}\s*(?::|=|est)\s*(?=[A-Za-z0-9._-]*\d)[A-Z0-9][A-Z0-9._-]{4,}\b/giu;
export const REFERENCE_ID_REGEX =
  /\b(?:r[ée]f[ée]rence|reference(?:[_\s-]?id)?|ref)\s*[:=]\s*(?=[A-Za-z0-9._-]*\d)[A-Z0-9][A-Z0-9._-]{4,}\b/giu;
export const EMPLOYEE_ID_REGEX =
  /\b(?:num[ée]ro\s+d['’]employ[ée]|employee(?:[_\s-]?id)?)\s*[:=]\s*(?=[A-Za-z0-9._-]*\d)[A-Z0-9][A-Z0-9._-]{4,}\b/giu;

// Numéro de projet / dossier : « Projet #992-B », « Projet : ABC-2024-17 »,
// « Dossier projet no 88-C ». Label-gated avec un MARQUEUR requis (#, :, no, n°)
// pour ne pas attraper une année (« projet 2024 ») ; le code doit contenir un
// chiffre. Casse sensible sur le code (un mot en minuscules collé n'est pas avalé).
// On anonymise le groupe 1 (le code) en gardant « Projet # » lisible.
// Le `(?![a-z])` après chaque segment est une frontière « camelCase » : si une
// majuscule est suivie d'une minuscule, c'est le début d'un mot collé (« 992-B »
// + « Date » → « 992-BDate ») et le code s'arrête juste avant.
export const PROJECT_REGEX =
  /\b(?:[Pp]rojet|[Pp]roject|[Dd]ossier(?:\s+(?:de\s+)?projet)?|[Nn]um[ée]ro\s+de\s+(?:projet|dossier))\s*(?:(?:[Nn][o°]\.?|[:#])\s*)+((?=[0-9A-Z-]*\d)[0-9A-Z]+(?![a-z])(?:-[0-9A-Z]+(?![a-z]))*)/g;

// Deux-points OPTIONNELS sur les trois regex bancaires : les documents inline
// écrivent « succursale 06721, transit 04531, compte 12-345-67 » sans « : ».
// Le transit accepte la forme composée avec tiret (« 815-30204 »).
export const BANK_INSTITUTION_REGEX =
  /\b(?:num[ée]ro\s+d['’])?(?:institution(?:\s+(?:bancaire|financi[èe]re))?|bank\s+institution)\s*[:=]?\s*\d{3}(?!\d)/gi;

export const BANK_TRANSIT_REGEX =
  /\b(?:num[ée]ro\s+de\s+)?(?:transit|succursale|branch)\s*[:=]?\s*\d{3,5}(?:-\d{3,5})?(?!\d)/gi;

export const BANK_ACCOUNT_REGEX =
  /\b(?:num[ée]ro\s+de\s+)?(?:compte(?:\s+bancaire)?|account(?:\s+number)?)\s*[:=]?\s*(?=[0-9A-Za-z-]*\d)[0-9A-Z-]{6,}\b/gi;

// « au compte se terminant par 4654 » / "account ending in 4654" — les 4
// derniers chiffres suffisent à identifier un compte ; on masque les chiffres.
export const ACCOUNT_LAST_DIGITS_REGEX =
  /\b(?:se\s+terminant\s+par|finissant\s+par|ending\s+(?:in|with))\s*:?\s*(\d{3,6})\b/gi;
export const SWIFT_CODE_REGEX = /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;
export const CREDIT_CARD_ONLY_REGEX = /(?<!\d)(?:\d{4}[\s-]?){3}\d{4}(?!\d)/g;
export const CARD_EXPIRY_ONLY_REGEX = /\b(?:0[1-9]|1[0-2])\/(?:\d{2}|\d{4})\b/g;
export const CVV_ONLY_REGEX = /\b(?:\d{3,4})\b/g;
export const POSTAL_CA_REGEX = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;
export const GPS_REGEX = /\b-?\d{1,2}\.\d{3,},\s*-?\d{1,3}\.\d{3,}\b/g;
export const LOCATION_SENSITIVE_REGEX =
  /\b(?:[Nn][ée]\s+[àa]|[Rr][ée]side\s+[àa]|[Rr]eside\s+in|[Bb]orn\s+in)\s+[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+(?:[ -][A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+){0,2}\b/g;
export const JDBC_REGEX = /\bjdbc:[a-z0-9:;@._/?=&%-]+/gi;
// URIs de connexion génériques avec identifiants embarqués (mongodb, postgres,
// mysql, redis, amqp, ldap…) — la chaîne entière (creds incluses) est masquée.
export const CONNECTION_URI_REGEX =
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|rediss|amqp|amqps|ldap|ldaps|sftp):\/\/[^\s'"<>]+/gi;
export const DB_HOST_REGEX = /\b(?:[a-z0-9-]+\.)+(?:local|lan|corp|internal|intra)\b/gi;
export const DB_USER_LINE_REGEX = /\b(?:oracle\s+user|db\s+user|user)\s*[:=]\s*["'“”‘’`]*[A-Za-z0-9._-]{3,}["'“”‘’`]*/gi;
export const DB_PASSWORD_LINE_REGEX = /\b(?:oracle\s+password|db\s+password|mot\s+de\s+passe|password)\s*[:=]\s*["'“”‘’`]*\S+["'“”‘’`]*/gi;
// host:port — l'hôte doit contenir une lettre, être "localhost" ou une IPv4 ;
// sinon des "nombre:nombre" comme une heure "10:30" seraient pris pour un hôte.
export const HOST_PORT_REGEX =
  /\b(?:localhost|[a-z0-9.-]*[a-z][a-z0-9.-]*|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}\b/gi;
export const SOCIAL_URL_REGEX = /\b(?:https?:\/\/(?:www\.)?(?:linkedin\.com\/in\/[^\s]+|instagram\.com\/[^\s]+|tiktok\.com\/@[^\s]+)|(?:linkedin|instagram|tiktok)\.com\/[^\s]+)\b/gi;
export const DOMAIN_REGEX = /(?<![A-Za-z0-9@])(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|ca|fr|io|ai|local|lan|corp|internal|intra)\b/gi;
export const ORGANIZATION_NAME_REGEX =
  /\b(?:Universit[ée]\s+du\s+Qu[ée]bec\s+[àa]\s+Trois-Rivi[èe]res|Universit[ée]\s+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ' -]+|Minist[èe]re\s+de\s+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ' -]+)\b/gi;
// Organisations françaises courantes que le NER (compromise) classe mal.
// PAS de flag `i` : la casse doit compter pour ne pas avaler les mots en
// minuscules qui suivent ("Société Générale participeront" -> on s'arrête).
// Mots-clés commerce ajoutés (Boutique, Restaurant, Marché…) + connecteurs en
// minuscules dans le nom (« Boutique Lys du Nord » entier, pas « Boutique Lys »
// avec « du Nord » qui fuit). ORGANIZATION (69) > PERSON (68) : l'entité
// complète l'emporte sur une capture partielle en personne.
// Frontière finale EXPLICITE (?![lettre]) et non \b : \b traite les lettres
// accentuées comme des non-mots et reculait la fin du match (« Doré » → « Dor »
// + fuite du « é »).
export const ORGANIZATION_FR_REGEX =
  /\b(?:(?:Société|Cabinet|Étude|Groupe|Compagnie|Boutique|Restaurant|Auberge|March[ée]|Boucherie|Boulangerie|P[âa]tisserie|Pharmacie|Garage|Salon|[ÉE]picerie|Librairie|Quincaillerie)\s+[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+(?:[ -](?:&\s+|et\s+|du\s+|des\s+|de\s+la\s+|de\s+l['’]|de\s+|le\s+|la\s+)?[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+){0,3}|[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+(?:[ -][A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+){0,2}\s+(?:&\s+|et\s+)?(?:Associés|Avocats|Notaires|Associates))(?![A-Za-zÀ-ÖØ-öø-ÿ])/g;
// Raison sociale française : forme juridique + dénomination, dans les deux
// ordres d'écriture (« SARL Les Ateliers du Marais », « Dupont & Fils SAS »).
// Sans ce détecteur, le NER découpait la dénomination en « personne » et
// laissait la forme juridique et l'article en clair (« SARL Les [PERSON_1] »).
// Pas de flag `i` : la casse distingue « SA » de « sa », « EI » de « ei ».
const FR_COMPANY_NAME =
  `[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+(?:[ -](?:&\\s+|et\\s+|du\\s+|des\\s+|de\\s+la\\s+|de\\s+l['’]|de\\s+|le\\s+|la\\s+|les\\s+)?[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+){0,4}`;
const FR_LEGAL_FORM =
  `(?:SARL|S\\.A\\.R\\.L\\.?|SASU|SAS|S\\.A\\.S\\.?|SA|S\\.A\\.|EURL|EIRL|EI|SCI|SCS|SNC|SCOP|SCM|SELARL|SELAS|SCP|SCA|GIE|GAEC|SEM|SEML|SPFPL|SCIC)`;
// Article ou préposition en minuscules entre la forme juridique et la
// dénomination (« SCI du Vieux Port », « SARL de la Tour »).
const FR_COMPANY_LEAD = `(?:(?:du|de\\s+la|de\\s+l['’]|de|des|le|la|les|au|aux)[ \\t]+)?`;
export const COMPANY_FR_LEGAL_REGEX = new RegExp(
  `\\b(?:${FR_LEGAL_FORM}[ \\t]+${FR_COMPANY_LEAD}${FR_COMPANY_NAME}` +
  `|${FR_COMPANY_NAME}[ \\t]+${FR_LEGAL_FORM})(?![A-Za-zÀ-ÖØ-öø-ÿ])`,
  'g',
);

// Autorise un connecteur en minuscules ("du", "de", "of"…) entre deux mots
// capitalisés pour capturer "Banque Nationale du Canada" en entier (sinon on
// s'arrêtait à "Banque Nationale" et "du Canada" fuyait).
// Connecteurs acceptés avec espace OU tiret (« Caisse Desjardins-de-la-Mauricie »)
// et descripteur « populaire » / « d'économie » après « Caisse ».
export const BANK_NAME_REGEX =
  /\b(?:(?:Banque|Caisse(?:\s+populaire)?(?:\s+d['’][ée]conomie)?)\s+(?:(?:du|des|de(?:[ -]la)?|d['’]|of)[ -])?[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]*(?:[ -](?:(?:du|des|de(?:[ -]la)?|la|d['’]|of)[ -])?[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]*){0,5}|National Bank|Bank of [A-Z][A-Za-z]+)(?![A-Za-zÀ-ÖØ-öø-ÿ])/g;

// Identifiants d'entreprise québécois/canadiens : NEQ (10 chiffres),
// TPS/GST et TVQ/QST (numéro de taxe + compte de programme RT/TQ/RP). On
// capture le libellé ET la valeur ; l'appelant n'anonymise que la valeur
// (groupe 2) et garde le libellé lisible. Ces numéros (souvent 10 chiffres)
// étaient auparavant pris pour des téléphones.
export const QC_BUSINESS_ID_REGEX =
  /\b(NEQ|TPS|GST|TVQ|QST|TVH|HST|BN|num[ée]ro\s+d['\u2019]entreprise|business\s+number)[^\n\d]{0,12}?(\d[\d -]{5,14}\d(?:\s*[A-Z]{2}\d{4})?)/gi;
export const MEDICAL_RECORD_REGEX = /\b(?:dossier\s+m[ée]dical|medical\s+record)\s*[:=]?\s*[A-Z]{1,5}-?\d{2,}(?:-\d+)*\b/gi;
// Médicament + dose : « Lisinopril 20mg », « Hydrochlorothiazide 12.5mg ».
// Gère les doses décimales (12.5 / 12,5) et plusieurs unités.
export const MEDICATION_REGEX =
  /\b[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+\s+\d{1,4}(?:[.,]\d{1,3})?\s*(?:mg|mcg|µg|ug|g|ml|UI)\b/g;
// Pas de flag `i` (mots-clés en alternative de casse) : sinon `[A-Z]` matche les
// minuscules et avale les mots suivants (ex. "Clinique Saint-Vincent ouverte").
// Descripteurs en minuscules tolérés après le mot-clé (« Clinique médicale des
// Forges ») — sinon seul « Clinique Médicale » (capitalisé) était capturé.
export const HEALTH_ORG_REGEX =
  /\b(?:[Cc]linique|[Hh][ôo]pital|[Hh]ospital|[Cc]entre\s+(?:hospitalier|m[ée]dical|de\s+sant[ée])|CHU|CHUM|CHUS)(?:\s+(?:m[ée]dicale?|dentaire|v[ée]t[ée]rinaire|familiale|chiropratique|priv[ée]e?)){0,2}(?:\s+(?:du|de(?:\s+la)?|des)\s+|\s+)[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+(?:[ -](?:du\s+|de\s+|des\s+|de\s+la\s+|of\s+)?[A-ZÀ-ÖØ-Ý][A-Za-zà-öø-ÿ]+){0,4}(?![A-Za-zÀ-ÖØ-öø-ÿ])/g;
// License plate — context-gated (mot-clé requis) pour éviter que des codes
// génériques "3 lettres + 3-4 chiffres" (codes de cours type INF1120, refs
// produits) ne soient pris pour des plaques. La plaque est capturée en fin.
// Tolère une parenthèse entre le libellé et la valeur (« Plaque d'immatriculation
// (véhicule de fonction) : K23 XPW ») et couvre les formats québécois
// « L##  LLL » (K23 XPW) et « ### LLL » (123 ABC) en plus des formats existants.
export const LICENSE_PLATE_REGEX =
  /\b(?:plaque(?:\s+d['’]immatriculation)?|immatriculation|(?:number\s+|license\s+)?plate)(?:\s*\([^)\n]{0,40}\))?\s*:?\s*([A-Z]{2,3}[- ]?\d{3,4}(?:[- ]?[A-Z]{1,2})?|[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}|[A-Z]\d{2}[- ]?[A-Z]{3}|\d{3}[- ]?[A-Z]{3}|\d{1,4}[- ]?[A-Z]{2,3}[- ]?\d{2,3})\b/gi;
export const VIN_REGEX = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
// Portefeuilles crypto : Ethereum (0x + 40 hex), Bitcoin (bech32 bc1… ou base58
// legacy commençant par 1/3). Très spécifiques -> peu de faux positifs.
export const CRYPTO_WALLET_REGEX =
  /\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;
// Libellé élargi (« Assurance collective police POL 4478-921 », valeur sur la
// ligne suivante) + préfixe POL autoporteur. Valeur : lettres + chiffres/tirets.
// Le libellé (« police d'assurance : ») reste HORS du groupe capturant : il
// doit rester lisible dans le texte anonymisé. La valeur, elle, est prise en
// entier — « AXA 1234 5567 8891 » et pas seulement « AXA 1234 », sinon la fin
// du numéro fuit à côté du placeholder.
export const INSURANCE_POLICY_REGEX =
  /\b(?:police(?:\s+d['’]assurance)?(?:\s+collective)?|insurance\s+policy)\s*(?:n[o°º]\.?\s*)?[:=]?\s*([A-Z]{2,}(?:[ -]?\d{2,}){1,5}|\d{3,}(?:[ -]\d{2,}){1,5})/gi;
// Forme autoportante « POL-4471902 », sans libellé.
export const INSURANCE_POLICY_BARE_REGEX = /\bPOL[ -]\d[\d-]{3,}\b/gi;

// Free-text salary phrasing.
export const SALARY_REGEX = /\b(?:gagne|touche|per[çc]oit|earns?|makes?|paid)\s+(?:[^\n.,;]*?)(?:\d[\d\s.,]*\s*(?:€|EUR|USD|CAD|GBP|CHF|\$|£)|\$\s?\d+[kKmM]?|\d+[kKmM]\b)(?:\s+(?:par\s+an|annually|per\s+year|\/an|\/year))?/gi;

// Broad context-aware patterns for semi-structured documents (school lists,
// onboarding sheets, exports). These are intentionally permissive.
export const NAME_STANDALONE_LINE_REGEX = /^(?:[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+){1,4})$/gmu;
export const CODE_STANDALONE_LINE_REGEX = /^(?:[A-Z]{3,8}\d{4,14}|[A-Z0-9]{4,}(?:[-_][A-Z0-9]{2,})+)$/gmu;
// La valeur DOIT contenir un chiffre (vrai code de cours/session : « INF1120 »,
// « A-2024 »). Sinon « Traitement en cours : Prescription » matchait « cours :
// Prescription » et anonymisait un mot courant.
// Deux-points optionnel et minimum 2 caractères : « Groupe 04 » / « groupe 302 »
// (numéro de groupe scolaire = quasi-identifiant) sont couverts, pas « groupe 4 ».
export const COURSE_OR_SESSION_CODE_REGEX = /\b(?:cours|course|session|groupe|group)\s*:?\s*(?=[A-Z0-9._-]*\d)[A-Z0-9._-]{2,}\b/giu;
export const LABELLED_PERSON_LINE_REGEX = /\b(?:professeur|enseignant|teacher|prof)\s*:\s*[^\n]+/giu;
// Le lookahead négatif après « nom » exclut les libellés techniques (« nom
// d'utilisateur », « nom de domaine/compte/fichier ») : leur valeur est un
// identifiant, pas une personne — sinon « Nom d'utilisateur : x » taguait
// « d'utilisateur » comme PERSON et laissait fuiter la valeur.
// Deux branches distinctes, et c'est essentiel :
// - « je m'appelle … » / « my name is … » : le séparateur est facultatif.
// - « nom … » : le séparateur [:=] est OBLIGATOIRE. Sans lui, la capture en
//   minuscules avalait les mots du LIBELLÉ lui-même (« Nom complet » → «complet»,
//   « Nom de jeune fille / nom d'usage » → « de » et « d'usage », « le nom de
//   votre premier animal » → « de votre premier animal »). Avec un séparateur
//   obligatoire, la valeur qui suit « Nom … : » est presque toujours capitalisée,
//   donc hors de la classe [a-z…] : plus aucun libellé n'est capturé.
// La borne de fin est un lookahead et non \b : sous le drapeau /u, \b est
// ASCII, donc « québécois composé » s'arrêtait sur « compos » et laissait un
// « é » orphelin collé au placeholder.
// PAS de drapeau /i, volontairement : la valeur capturée doit être en
// MINUSCULES (c'est tout l'intérêt de ce détecteur — retrouver « je m'appelle
// jean dupont », que les détecteurs de noms capitalisés ratent). Sous /i, la
// classe [a-zà-öø-ÿ] acceptait aussi les capitales et la capture partait dans
// le texte suivant. La casse du LIBELLÉ est donc traitée à la main.
// Les séparateurs internes sont [ \t] et non \s : sans cela la capture
// franchissait le saut de ligne et avalait le début de la ligne suivante
// (« Nom complet : Camille Fontaine\nNom de » -> PERSON « de »).
export const SELF_INTRO_PERSON_REGEX =
  /\b(?:(?:[Jj]e\s+m['’]?\s*appelle?|[Jj]e\s+m\s+appel|[Mm]y\s+name\s+is)[ \t]*[:=]?[ \t]+|[Nn][Oo][Mm](?:[ \t]+[Cc]omplet)?(?![ \t]*d['’][ \t]*utilisateur|[ \t]+de[ \t]+(?:domaine|compte|fichier|s[ée]rie)\b|[ \t]+du[ \t]+(?:compte|poste|serveur)\b)[ \t]*[:=][ \t]*)([a-zà-öø-ÿ'’-]+(?:[ \t]+[a-zà-öø-ÿ'’-]+){0,3})(?![a-zà-öø-ÿ'’-])/gu;
// Civilité COLLÉE au nom, avec ou sans point : « Me.Delvaux », « MeVasseur »,
// « DrTremblay ». Les détecteurs de noms attendent une espace après la civilité
// et laissaient donc ces formes en clair. On ne capture que le NOM (groupe 1)
// pour que la civilité reste lisible.
export const TITLE_GLUED_PERSON_REGEX =
  /\b(?:M(?:e|me|lle|tre)|Dre?|Pre?|Prof)\.?(?=[A-ZÀ-ÖØ-Ý])([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,}(?:-[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+)*)/g;
// Quebec-like permanent code: 4 letters + 8 digits (e.g. LALJ01379200)
export const ACADEMIC_PERMANENT_CODE_REGEX = /\b[A-Z]{4}\d{8}\b/g;
// Seasonal academic session labels (Hiver 2026, Fall 2026, etc.)
export const ACADEMIC_TERM_REGEX = /\b(?:hiver|printemps|automne|[ée]t[ée]|ete|winter|spring|summer|fall|autumn)\s+\d{4}\b/giu;

// Generic ID pattern - MUST contain at least one digit
// This avoids matching normal French/English words like "Jean-Pierre", "Compte-rendu"
export function createIdRegex(minLength: number): RegExp {
  // All patterns MUST contain at least one digit to be considered an ID
  const patterns = [
    // IDs with separators containing digits.
    // First segment now starts with a letter but may contain digits
    // ("B12-345-678-9012" — would otherwise be missed because the original
    // `[A-Z]+` required all-letters before the first separator). The
    // 6-char minimum lookahead avoids matching tiny "X-1" / "PR-1" noise.
    `(?=[A-Z0-9-_]{6,})(?=[A-Z0-9-_]*[0-9])[A-Z][A-Z0-9]*[-_][A-Z0-9]+(?:[-_][A-Z0-9]+)*`,
    // Alphanumeric IDs with both letters AND digits (no separators) - e.g., ABC123DEF, 2024Q4
    `(?=[A-Z]*[0-9])(?=[0-9]*[A-Z])[A-Z0-9]{${minLength},}`,
    // All-digit IDs with ≥3 dash-separated segments and ≥8 chars total
    // (matricule foncier « 7823-45-1290-0-000-0000 », no de prêt « 7300-451-882 »).
    // Les dates ISO et téléphones qui matchent aussi sont repris par leurs
    // détecteurs prioritaires (DATE 66, PHONE 85 > ID 15).
    `(?=[\\d-]{8,})\\d+(?:-\\d+){2,}`,
  ];

  return new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'gi');
}

// Find all matches with positions.
export function findAllMatches(
  text: string,
  regex: RegExp
): Array<{ value: string; startIndex: number; endIndex: number }> {
  const matches: Array<{ value: string; startIndex: number; endIndex: number }> = [];
  const flags = 'g' + (regex.ignoreCase ? 'i' : '');
  const globalRegex = new RegExp(regex.source, flags);

  let match;
  while ((match = globalRegex.exec(text)) !== null) {
    matches.push({
      value: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
    // Avoid infinite loop for zero-width matches.
    if (match.index === globalRegex.lastIndex) globalRegex.lastIndex++;
  }

  return matches;
}

// Escape special regex characters
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find term in text (with word boundaries)
export function findTermInText(
  text: string,
  term: string,
  caseSensitive: boolean = false
): Array<{ value: string; startIndex: number; endIndex: number }> {
  const escapedTerm = escapeRegex(term);
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(`\\b${escapedTerm}\\b`, flags);

  return findAllMatches(text, regex);
}

// ── Indices de profil (vocabulaire de contexte) ─────────────────────────────
// Hoistés en top-level pour que l'obfuscateur du chunk `engine` les encode :
// inline dans une fonction, « code permanent » & co apparaissaient en clair
// dans le bundle livré.
export const ACADEMIC_HINT_REGEX =
  /\b(?:code permanent|cours|session|professeur|enseignant|etudiant|étudiant|groupe)\b/i;
export const HR_HINT_REGEX =
  /\b(?:ressources humaines|employee|employe|employé|staff|manager|salaire|salary|matricule)\b/i;
export const LEGAL_HINT_REGEX =
  /\b(?:contrat|clause|avenant|juridique|legal|agreement|article|partie)\b/i;
export const NAME_SECTION_HINT_REGEX = /\bcode permanent\b|\bnom membre du groupe\b/;
