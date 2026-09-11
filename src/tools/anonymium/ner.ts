// Ported verbatim from Anonymum/src/utils/ner.ts (compromise NLP + FR/EN rule
// patterns + first-name gazetteer, behind the same pluggable provider API).
import nlp from 'compromise';
import { isKnownFirstName } from './name-gazetteer';

export interface NerMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  type: 'person' | 'organization';
}

// Particles that can appear between a first and last name in French/Dutch/
// German/Italian/Spanish/Portuguese/Irish surnames. These are NOT capitalized
// in most styles ("Francois d'Aubigne", "Jean de la Fontaine", "Vincent van
// Gogh"). We keep them as a non-capturing optional group so the captured
// last name still starts at a capital letter.
const NAME_PARTICLE = `(?:d['e]|de\\s+la|de\\s+l'|du|de|della|del|von|van|der|den|da|di|das|dos|le|la|O')`;

// French name patterns - common first names and compound names, with optional
// surname particle between first and last name.
// La première lettre de chaque token accepte les MAJUSCULES ACCENTUÉES
// ([A-ZÀ-ÖØ-Ý]) — sinon "Émilie" (É) n'était pas reconnu — et chaque token
// admet PLUSIEURS segments à trait d'union (Tremblay-Gagnon, Marie-Pier-Anne).
// Reprise capitale après apostrophe admise dans chaque segment (« D'Anjou »,
// « O'Brien ») — sinon le nom était coupé à l'apostrophe.
const NAME_TOKEN = `[A-ZÀ-ÖØ-Ý][a-zàâäéèêëïîôùûüç]*(?:['’][A-ZÀ-ÖØ-Ý][a-zàâäéèêëïîôùûüç]+)?(?:-[A-ZÀ-ÖØ-Ý][a-zàâäéèêëïîôùûüç]*(?:['’][A-ZÀ-ÖØ-Ý][a-zàâäéèêëïîôùûüç]+)?)*`;
const FRENCH_NAME_PATTERN = new RegExp(
  `\\b(${NAME_TOKEN})\\s+(?:${NAME_PARTICLE}\\s*)?(${NAME_TOKEN})\\b`,
  'g',
);

// Organization patterns - words followed by typical company suffixes or capitalized multi-word names
const ORG_SUFFIXES = [
  'Solutions', 'Services', 'Consulting', 'Corp', 'Corporation', 'Inc', 'LLC', 'Ltd',
  'SA', 'SAS', 'SARL', 'EURL', 'Group', 'Groupe', 'International', 'Technologies',
  'Tech', 'Software', 'Systems', 'Partners', 'Associates', 'Company', 'Co',
];

const ORG_PATTERN = new RegExp(
  `\\b([A-Z][a-zA-Zàâäéèêëïîôùûüç]*(?:\\s+[A-Z][a-zA-Zàâäéèêëïîôùûüç]*)*)\\s+(${ORG_SUFFIXES.join('|')})\\b`,
  'g'
);

// Common French/English words and section headers that must NOT be detected
// as names. Matched case-insensitively below.
const STOP_WORDS_RAW = [
  // Greetings / sign-offs
  'Bonjour', 'Bonsoir', 'Cordialement', 'Salut', 'Merci', 'Bien',
  // Titles / honorifics (we already strip these via TITLE_REGEX)
  'Madame', 'Monsieur', 'Mademoiselle', 'Madam', 'Sir',
  // Participes et auxiliaires français que compromise confond avec des sigles
  // ou des marques (« a eu lieu » -> l'organisation « EU »).
  'Eu', 'Été', 'Ete', 'Fait', 'Faits', 'Dit', 'Dite', 'Pris', 'Prise', 'Mis', 'Mise',
  'Vu', 'Vue', 'Su', 'Dû', 'Du', 'Été', 'Soit', 'Sont', 'Étant', 'Etant',
  // Common French nouns that often appear capitalised in headers
  'Suite', 'Pour', 'Dans', 'Avec', 'Cette', 'Votre', 'Notre', 'Leur', 'Cher', 'Chère',
  'Faire', 'Avoir', 'Être', 'Reçu', 'Envoyé', 'Envoi',
  'Actions', 'Contact', 'Email', 'Projet', 'Client', 'Dossier', 'Objet',
  'Date', 'Lieu', 'Code', 'Type', 'Nom', 'Titre', 'Sujet', 'Message',
  'Référence', 'Reference', 'Numéro', 'Numero', 'Compte', 'Rapport',
  'Réunion', 'Reunion', 'Question', 'Profil', 'Salaire',
  'Directeur', 'Directrice', 'Responsable', 'Chef', 'Équipe', 'Equipe', 'Service',
  // Vocabulaire de facture / commande / billetterie (EN + FR) : en tête de
  // colonne ou de ligne, ces mots sont capitalisés et Compromise les prend
  // pour des noms (« Invoice Number », « Order Total », « Dear A »…). On
  // évite sciemment les vrais patronymes anglais (Price, Bill, Grant).
  'Invoice', 'Number', 'Description', 'Unit', 'Quantity', 'Amount', 'Total', 'Order',
  'Subtotal', 'Sub-Total', 'Dear', 'Event', 'Payment', 'Purchase', 'Supply', 'Gross',
  'Net', 'Tax', 'Ticket', 'Admission', 'Thank', 'Please', 'Receipt', 'Item', 'Items',
  'Facture', 'Montant', 'Quantité', 'Quantite', 'Unitaire', 'Commande', 'Sous-total',
  'Événement', 'Evenement', 'Billet', 'Paiement', 'Achat', 'Taxe', 'Taxes', 'Reçu',
  // Section headers we use in test fixtures and real documents
  'Adresses', 'Contacts', 'Reception', 'Réception', 'Entites', 'Entités',
  'Donnees', 'Données', 'Personnelles', 'Sante', 'Santé', 'Contexte', 'Sensible',
  'References', 'Références', 'Infrastructure', 'Secrets', 'Finances',
  'Permis', 'Passeport', 'Passport', 'Bureau', 'Siege', 'Siège', 'Hebergement', 'Hébergement',
  'Acompte', 'Frais', 'Montant', 'Budget', 'Banque', 'Guichet', 'Cle', 'Clé',
  'Lead', 'Adjointe', 'Adjoint', 'Suivi', 'Operationnel', 'Opérationnel',
  'Note', 'Notes', 'Status', 'Statut', 'Important', 'Attention',
  'Equipe', 'Team', 'Profil', 'Carte', 'Card', 'Comptes', 'Bancaires', 'Comptable',
  'Domicile', 'Office', 'Address', 'Adresse', 'Domaine', 'Portail',
  'Serveur', 'Switch', 'Router', 'Gateway', 'DNS',
  'Credentials', 'Identifiants', 'Mot', 'Passe', 'Password',
  'Ticket', 'Issue', 'Bug', 'Feature', 'Tache', 'Tâche',
  'Conseil', 'Juridique', 'Maitre', 'Maître',
  'Ressources', 'Humaines',
  // Institutions / collectivités souvent capitalisées (évite faux positifs PERSON)
  'Mairie', 'Municipal', 'Municipale', 'Ministère', 'Ministere', 'Société',
  'Societe', 'Université', 'Universite', 'Collège', 'College', 'Hôpital',
  'Hopital', 'Clinique', 'Département', 'Departement', 'Association', 'Comité',
  'Comite', 'Commission', 'Assemblée', 'Assemblee', 'Fédération', 'Federation',
  'République', 'Republique', 'National', 'Nationale', 'Central', 'Centrale',
  'Général', 'Générale', 'Generale', 'Régional', 'Regional', 'Agence',
  'Institut', 'Fondation', 'Syndicat', 'American', 'Express',
  // Titres / civilités que compromise tague parfois comme des noms
  'Dr', 'Dre', 'Drs', 'Pr', 'Pre', 'Prof', 'Me', 'Mtre',
  // En-têtes de fiches / sections médicales et administratives
  'Fiche', 'Suivi', 'Médical', 'Medical', 'Médicale', 'Medicale', 'Médicales', 'Medicales',
  'Informations', 'Information', 'Personnelles', 'Personnel', 'Personnelle',
  'Sensibles', 'Sensible', 'Administratif', 'Administrative', 'Administratives',
  'Financières', 'Financière', 'Financier', 'Financieres', 'Financiere',
  'Antécédents', 'Antecedents', 'Diagnostic', 'Diagnostics', 'Traitement', 'Traitements',
  'Prescription', 'Prescriptions', 'Responsable', 'Institution', 'Coordonnées', 'Coordonnees',
  'Associés', 'Associes', 'Avocats', 'Notaires', 'Cabinet', 'Étude',
  // Card brands (sometimes Compromise tags them as PERSON in label position)
  'Discover', 'Visa', 'Mastercard', 'MasterCard', 'Amex',
  // Vendor / product names that frequently appear as labels rather than as
  // the customer being anonymized
  'OpenAI', 'Anthropic', 'Slack', 'GitHub', 'Github', 'Google', 'AWS', 'Stripe',
  'Twitter', 'LinkedIn', 'Facebook', 'Instagram', 'Microsoft', 'Apple',
  'Amazon', 'Netflix', 'Uber', 'Jira', 'Notion', 'Figma', 'Zoom',
  'WordPress', 'Wordpress', 'Elementor', 'Shopify', 'Wix', 'Squarespace',
  'Vultr', 'OVH', 'Cloudflare', 'Vercel', 'Netlify',
  // Moyens de paiement / mots communs financiers (jamais des prénoms)
  'Interac', 'PayPal', 'Paypal', 'Virement', 'Paiement', 'Versement', 'Acompte',
  // Institutions financières CA/US/FR & réseaux de cartes (marques, pas des
  // personnes — BANK_NAME_REGEX couvre les formes « Banque X » complètes)
  'Desjardins', 'Tangerine', 'Scotiabank', 'CIBC', 'BMO', 'RBC', 'TD',
  'Chase', 'Citibank', 'Citi', 'Wells', 'Fargo', 'Fidelity', 'Vanguard',
  'Amex', 'Transit',
  // Organismes publics FR & produits d'épargne
  'CAF', 'URSSAF', 'Pôle', 'Pole', 'Livret',
  // Mutuelles / assurances
  'Harmonie', 'Mutuelle', 'Assurance', 'Assurances',
  // Médicaments courants (le détecteur MEDICATION gère « nom + dose »)
  'Ventolin', 'Lisinopril', 'Hydrochlorothiazide', 'Metformin', 'Metformine',
  'Advil', 'Tylenol', 'Aspirine', 'Aspirin', 'Doliprane', 'Synthroid',
  'Crestor', 'Lipitor', 'Ozempic', 'Ativan', 'Xanax',
  // Jetons de chaîne « user agent » : « Intel Mac OS X » produisait le faux
  // positif PERSON « Intel Mac ».
  'Mozilla', 'Macintosh', 'Intel', 'Mac', 'AppleWebKit', 'KHTML', 'Gecko',
  'Safari', 'Chrome', 'Firefox', 'Edge', 'Windows', 'Linux', 'Android',
  // Generic auth / token labels
  'Bearer', 'Authorization', 'JWT', 'Token', 'Session', 'API',
  'PAT', 'PIN', 'OTP', 'MFA', '2FA', 'SSO', 'OAuth',
  // Acronymes d'identifiants (labels, pas des noms). Construits depuis une seule
  // chaîne longue : le string-array de l'obfuscateur l'encode en base64 (les
  // chaînes courtes restent en clair), donc « NAS » & co ne fuient pas au grep.
  ...'NAS SIN SSN NIR TVA RIB SIRET SIREN BIC SWIFT IBAN'.split(' '),
  // Job-title fragments — combine in two-word patterns like "Senior Partner",
  // "Managing Director", "Vice President" that Compromise / NER otherwise
  // misclassifies as PERSON.
  'Senior', 'Junior', 'Managing', 'Partner', 'Associate', 'Officer',
  'Vice', 'President', 'Presidente', 'Présidente', 'Chief', 'Founder',
  'Co-Founder', 'Cofounder', 'Owner', 'Head', 'Chair', 'Chairman', 'Chairwoman',
  'Manager', 'Director', 'Directeur', 'Directrice', 'Engineer', 'Ingenieur',
  'Ingénieur', 'Designer', 'Developer', 'Developpeur', 'Développeur',
  'Consultant', 'Analyst', 'Analyste', 'Architect', 'Architecte',
  'Specialist', 'Spécialiste', 'Coordinator', 'Coordinateur', 'Coordinatrice',
  'Stagiaire', 'Intern', 'Apprenti', 'Apprentice',
  'CEO', 'CTO', 'CFO', 'COO', 'CIO', 'CSO', 'CMO', 'CHRO', 'CRO',
  'EVP', 'SVP', 'VP', 'PDG', 'DRH', 'DSI', 'DAF',
  // Days / months
  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  // Common English business words
  'Hello', 'Hi', 'Regards', 'Best', 'Sincerely', 'Thanks',
  'Office', 'Project', 'Team', 'Department', 'Manager', 'Director',
  'Subject', 'From', 'To', 'CC', 'BCC', 'Re', 'Fwd',
];
const FRENCH_STOP_WORDS = new Set(STOP_WORDS_RAW.map((w) => w.toLowerCase()));
const isStopWord = (token: string): boolean => FRENCH_STOP_WORDS.has(token.toLowerCase());

// Multi-token labels Compromise sometimes returns as a single entity
// where the per-token stop-word check can't catch them. Compared
// whole-string after lowercasing AND stripping trailing punctuation
// (Compromise sometimes returns "American Express." with the trailing
// period attached).
const STOP_PHRASES = new Set([
  // Card brands
  'american express',
  'diners club',
  'diners club international',
  'jcb international',
  'union pay',
  'unionpay',
  // Vendor / product corporate names
  'google llc',
  'google inc',
  'meta platforms',
  'open ai',
  // Cities — Compromise tags multi-word place names as PERSON when they
  // appear in narrative ("notre correspondant à New York est...").
  'new york',
  'new orleans',
  'los angeles',
  'san francisco',
  'san diego',
  'san jose',
  'las vegas',
  'fort worth',
  'long beach',
  'el paso',
  'rio de janeiro',
  'sao paulo',
  'mexico city',
  'cape town',
  'hong kong',
  'kuala lumpur',
  'tel aviv',
  'abu dhabi',
  'cote d ivoire',
  'cote d\'ivoire',
  // Institutions / organismes multi-mots (jamais des personnes)
  'caisse d\'épargne',
  'caisse d\'epargne',
  'harmonie mutuelle',
  'pôle emploi',
  'pole emploi',
  'france travail',
  'livret a',
  'transit desjardins',
  'carte amex',
  'wells fargo',
  'bank of america',
  'credit agricole',
  'crédit agricole',
  'société générale',
  'societe generale',
]);
const isStopPhrase = (entity: string): boolean =>
  STOP_PHRASES.has(
    entity
      .toLowerCase()
      .replace(/[.,;:!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

// Common titles that precede names
const TITLE_PATTERNS = [
  'M\\.', 'Mme', 'Mlle', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof',
  'Monsieur', 'Madame', 'Mademoiselle',
];

const TITLE_REGEX = new RegExp(
  `(?:${TITLE_PATTERNS.join('|')})\\s+(${NAME_TOKEN}(?:\\s+(?:${NAME_PARTICLE}\\s*)?${NAME_TOKEN})?)`,
  'g'
);

// Strip noise that Compromise sometimes includes around an entity:
//   "Marie-Claire Bernard (marie-claire.bernard@acme.fr),"
//     → "Marie-Claire Bernard"
//   "Mr. Robert Johnson,"
//     → "Robert Johnson" (title pulled off so the name match starts at
//      the actual surname rather than dragging the title into the
//      placeholder)
const TITLE_PREFIX = /^(?:M\.|Mme|Mlle|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Maitre|Maître|Me\.?|Monsieur|Madame|Mademoiselle)\s+/;

const cleanEntity = (raw: string): string =>
  raw
    .replace(/\s*[([].*$/, '') // drop "(...)" / "[...]" tail
    .replace(/[,;:!?.]+$/, '') // strip trailing punctuation (incl. ".")
    .replace(TITLE_PREFIX, '') // strip leading title
    .replace(/\s+/g, ' ') // collapse new lines / tabs to plain spaces
    .trim();

// Detect persons using compromise NLP + French patterns
export function detectPersons(text: string): NerMatch[] {
  const matches: NerMatch[] = [];
  const seen = new Set<string>();

  // Use compromise for English-style names
  const doc = nlp(text);
  const peopleRaw = doc.people().out('array') as string[];
  // 3 caractères minimum : compromise, orienté anglais, rend des jetons de
  // deux lettres (« eu » du français « a eu lieu ») qu'il prend pour des
  // sigles. Masquer deux lettres n'a aucune valeur et détruit le texte.
  const people = peopleRaw.map(cleanEntity).filter((p) => p.length >= 3);

  for (const person of people) {
    if (seen.has(person.toLowerCase())) continue;
    if (isStopPhrase(person)) {
      seen.add(person.toLowerCase());
      continue;
    }

    // Skip if every word-bearing token is a stop word. We strip leading/
    // trailing punctuation per token because Compromise sometimes returns
    // values like "PAT :" (with the colon attached) — naive split would
    // see [PAT, :] and the colon is obviously not in our stop-word list,
    // so the all-stopwords check would falsely fail.
    const tokens = person
      .split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter(Boolean);
    if (tokens.length === 0 || tokens.every((t) => isStopWord(t))) {
      seen.add(person.toLowerCase());
      continue;
    }
    // If compromise glues a real surname with a stop-word token
    // across line breaks ("Biskri Acces"), reject it as a person.
    if (tokens.length >= 2 && tokens.some((t) => isStopWord(t))) {
      seen.add(person.toLowerCase());
      continue;
    }
    // Single-token "person" candidates are aggressively pruned: the FR/EN
    // patterns below catch real two-token names with better precision.
    // We also skip lowercase-first single tokens to avoid French verbs
    // like "marie" (past participle of "marier") being tagged as people.
    if (tokens.length === 1) {
      const tok = tokens[0];
      if (isStopWord(tok) || !/^[A-ZÀ-Ö]/.test(tok)) {
        seen.add(person.toLowerCase());
        continue;
      }
    }

    // Find all occurrences in text
    let searchStart = 0;
    while (true) {
      const idx = text.indexOf(person, searchStart);
      if (idx === -1) break;

      // Reject mid-word matches: Compromise sometimes returns truncated tokens
      // (e.g. "Sociét" out of "Société Générale"), which would leak the rest of
      // the word around the placeholder.
      const before = idx > 0 ? text[idx - 1] : '';
      const after = idx + person.length < text.length ? text[idx + person.length] : '';
      if (/\p{L}/u.test(before) || /\p{L}/u.test(after)) { searchStart = idx + 1; continue; }

      matches.push({
        value: person,
        startIndex: idx,
        endIndex: idx + person.length,
        type: 'person',
      });
      searchStart = idx + 1;
    }
    seen.add(person.toLowerCase());
  }

  // French name pattern detection
  let match;
  const frenchRegex = new RegExp(FRENCH_NAME_PATTERN.source, 'g');
  while ((match = frenchRegex.exec(text)) !== null) {
    const fullName = match[0];
    const firstName = match[1];
    const lastName = match[2];
    if (/[\r\n]/.test(fullName)) continue;

    // Skip if either token is a stop word, OR the full multi-word value
    // is a known stop phrase (card brands, vendor names, multi-word
    // cities) — without this check, "American Express" would be tagged
    // as PERSON since neither "American" nor "Express" alone is a stop
    // word.
    if (isStopWord(firstName) || isStopWord(lastName) || isStopPhrase(fullName)) continue;

    // Skip if already detected
    if (seen.has(fullName.toLowerCase())) continue;

    matches.push({
      value: fullName,
      startIndex: match.index,
      endIndex: match.index + fullName.length,
      type: 'person',
    });
    seen.add(fullName.toLowerCase());
  }

  // Title-based detection (M. Dupont, Mme Martin, etc.)
  const titleRegex = new RegExp(TITLE_REGEX.source, 'g');
  while ((match = titleRegex.exec(text)) !== null) {
    const name = match[1];
    if (!name || seen.has(name.toLowerCase())) continue;
    if (/[\r\n]/.test(name)) continue;

    // Skip if every token in the captured name is a stop word, OR if
    // the full captured name is a known stop phrase (card brands,
    // vendors, multi-word cities).
    const nameTokens = name.split(/\s+/);
    if (nameTokens.every((t) => isStopWord(t)) || isStopPhrase(name)) continue;

    // Find the name part (without title) in text
    const nameStart = match.index + match[0].indexOf(name);
    matches.push({
      value: name,
      startIndex: nameStart,
      endIndex: nameStart + name.length,
      type: 'person',
    });
    seen.add(name.toLowerCase());
  }

  return matches;
}

// Detect organizations using compromise NLP + patterns
export function detectOrganizations(text: string): NerMatch[] {
  const matches: NerMatch[] = [];
  const seen = new Set<string>();

  // Use compromise for organizations
  const doc = nlp(text);
  const orgsRaw = doc.organizations().out('array') as string[];
  const orgs = orgsRaw.map(cleanEntity).filter((o) => o.length >= 3);

  for (const org of orgs) {
    if (seen.has(org.toLowerCase())) continue;
    if (isStopPhrase(org)) {
      seen.add(org.toLowerCase());
      continue;
    }

    // Skip section headers / common labels that Compromise sometimes
    // misclassifies as orgs ("Secrets", "Ticket Jira", vendor names like
    // "GitHub" / "Google" used as labels rather than as the customer).
    // Same punctuation-stripping logic as the persons branch.
    const orgTokens = org
      .split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter(Boolean);
    if (orgTokens.length === 0 || orgTokens.every((t) => isStopWord(t))) {
      seen.add(org.toLowerCase());
      continue;
    }
    if (orgTokens.length === 1 && isStopWord(orgTokens[0])) {
      seen.add(org.toLowerCase());
      continue;
    }

    let searchStart = 0;
    while (true) {
      const idx = text.indexOf(org, searchStart);
      if (idx === -1) break;

      const before = idx > 0 ? text[idx - 1] : '';
      const after = idx + org.length < text.length ? text[idx + org.length] : '';
      if (/\p{L}/u.test(before) || /\p{L}/u.test(after)) { searchStart = idx + 1; continue; }

      matches.push({
        value: org,
        startIndex: idx,
        endIndex: idx + org.length,
        type: 'organization',
      });
      searchStart = idx + 1;
    }
    seen.add(org.toLowerCase());
  }

  // Pattern-based organization detection
  let match;
  const orgRegex = new RegExp(ORG_PATTERN.source, 'g');
  while ((match = orgRegex.exec(text)) !== null) {
    const fullOrg = match[0];
    
    if (seen.has(fullOrg.toLowerCase())) continue;
    
    matches.push({
      value: fullOrg,
      startIndex: match.index,
      endIndex: match.index + fullOrg.length,
      type: 'organization',
    });
    seen.add(fullOrg.toLowerCase());
  }

  return matches;
}

// Détection de prénoms SEULS via gazetteer : compromise rate les noms à 1 token
// et les prénoms non-occidentaux (Mohammed, Wei, Aïcha…). On exige une initiale
// majuscule et on exclut les stop-words.
export function detectGazetteerNames(text: string): NerMatch[] {
  const matches: NerMatch[] = [];
  const re = /\b[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (isKnownFirstName(tok) && !isStopWord(tok)) {
      matches.push({ value: tok, startIndex: m.index, endIndex: m.index + tok.length, type: 'person' });
    }
  }
  return matches;
}

// ---- Abstraction NER pluggable -------------------------------------------
// Permet de remplacer le moteur NER (compromise aujourd'hui, un modèle ML
// chargé à la demande demain) sans toucher au reste du moteur d'anonymisation.

export interface NerOptions {
  persons?: boolean;
  organizations?: boolean;
}

export interface NerProvider {
  readonly name: string;
  // Optionnel : pré-calcul ASYNC (ex. inférence d'un modèle ML) avant la
  // détection. Le moteur d'anonymisation reste SYNCHRONE : un provider ML lance
  // l'inférence ici et met ses résultats en cache, que detect() (sync) relit
  // ensuite. L'UI appelle `await getNerProvider().preload?.(text)` avant
  // anonymize(). Recette complète : docs/NER_ML_INTEGRATION.md.
  preload?(text: string): Promise<void>;
  detect(text: string, options?: NerOptions): NerMatch[];
}

// Un détecteur ne doit jamais consommer les guillemets ou la ponctuation qui
// DÉLIMITENT une valeur : dans un journal JSON, « "full_name": "Andrea
// Steinmann" » devenait « "full_name": [PERSON_1] », guillemets compris, donc
// du JSON invalide.
/** Rétrécit le span jusqu'aux vraies bornes de la valeur. */
function trimDelimiters(match: NerMatch, text: string): NerMatch {
  const raw = text.slice(match.startIndex, match.endIndex);
  const leading = raw.length - raw.replace(/^[\s"'“”‘’`«»([]+/, '').length;
  const trailing = raw.length - raw.replace(/[\s"'“”‘’`«»)\],;:.]+$/, '').length;
  if (leading === 0 && trailing === 0) return match;
  const start = match.startIndex + leading;
  const end = match.endIndex - trailing;
  if (end <= start) return match;
  return { ...match, value: text.slice(start, end), startIndex: start, endIndex: end };
}

// Implémentation actuelle : règles FR/EN + compromise.
export const compromiseNerProvider: NerProvider = {
  name: 'compromise',
  detect(text: string, options: NerOptions = { persons: true, organizations: true }): NerMatch[] {
    const matches: NerMatch[] = [];
    if (options.persons) {
      matches.push(...detectPersons(text));
      matches.push(...detectGazetteerNames(text));
    }
    if (options.organizations) matches.push(...detectOrganizations(text));
    const trimmed = matches
      .map((m) => trimDelimiters(m, text))
      .filter((m) => m.endIndex > m.startIndex && m.value.trim().length > 0);
    trimmed.sort((a, b) => a.startIndex - b.startIndex);
    return trimmed;
  },
};

let activeNerProvider: NerProvider = compromiseNerProvider;

/** Remplace le fournisseur NER actif (ex. brancher un modèle ML lazy-loadé). */
export function setNerProvider(provider: NerProvider): void {
  activeNerProvider = provider;
}

/** Fournisseur NER actif. */
export function getNerProvider(): NerProvider {
  return activeNerProvider;
}

// Détection NER combinée — route via le fournisseur actif (API publique stable).
export function detectEntities(text: string, options?: NerOptions): NerMatch[] {
  return activeNerProvider.detect(text, options ?? { persons: true, organizations: true });
}
