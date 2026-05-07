// Ported from Anonymium/src/utils/ner.ts — uses compromise NLP for English
// names, plus French regex patterns and curated stop-word lists.

import nlp from 'compromise';

export interface NerMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  type: 'person' | 'organization';
}

const NAME_PARTICLE = `(?:d['e]|de\\s+la|de\\s+l'|du|de|della|del|von|van|der|den|da|di|das|dos|le|la|O')`;

const FRENCH_NAME_PATTERN = new RegExp(
  `\\b([A-Z][a-zàâäéèêëïîôùûüç]+(?:-[A-Z][a-zàâäéèêëïîôùûüç]+)?)\\s+(?:${NAME_PARTICLE}\\s*)?([A-Z][a-zàâäéèêëïîôùûüç]+(?:-[A-Z][a-zàâäéèêëïîôùûüç]+)?)\\b`,
  'g',
);

const ORG_SUFFIXES = [
  'Solutions', 'Services', 'Consulting', 'Corp', 'Corporation', 'Inc', 'LLC', 'Ltd',
  'SA', 'SAS', 'SARL', 'EURL', 'Group', 'Groupe', 'International', 'Technologies',
  'Tech', 'Software', 'Systems', 'Partners', 'Associates', 'Company', 'Co',
];

const ORG_PATTERN = new RegExp(
  `\\b([A-Z][a-zA-Zàâäéèêëïîôùûüç]*(?:\\s+[A-Z][a-zA-Zàâäéèêëïîôùûüç]*)*)\\s+(${ORG_SUFFIXES.join('|')})\\b`,
  'g',
);

const STOP_WORDS_RAW = [
  'Bonjour', 'Bonsoir', 'Cordialement', 'Salut', 'Merci', 'Bien',
  'Madame', 'Monsieur', 'Mademoiselle', 'Madam', 'Sir',
  'Suite', 'Pour', 'Dans', 'Avec', 'Cette', 'Votre', 'Notre', 'Leur', 'Cher', 'Chère',
  'Faire', 'Avoir', 'Être', 'Reçu', 'Envoyé', 'Envoi',
  'Actions', 'Contact', 'Email', 'Projet', 'Client', 'Dossier', 'Objet',
  'Date', 'Lieu', 'Code', 'Type', 'Nom', 'Titre', 'Sujet', 'Message',
  'Référence', 'Reference', 'Numéro', 'Numero', 'Compte', 'Rapport',
  'Réunion', 'Reunion', 'Question', 'Profil', 'Salaire',
  'Directeur', 'Directrice', 'Responsable', 'Chef', 'Équipe', 'Equipe', 'Service',
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
  'Discover', 'Visa', 'Mastercard', 'MasterCard', 'Amex',
  'OpenAI', 'Anthropic', 'Slack', 'GitHub', 'Github', 'Google', 'AWS', 'Stripe',
  'Twitter', 'LinkedIn', 'Facebook', 'Instagram', 'Microsoft', 'Apple',
  'Amazon', 'Netflix', 'Uber', 'Jira', 'Notion', 'Figma', 'Zoom',
  'Bearer', 'Authorization', 'JWT', 'Token', 'Session', 'API',
  'PAT', 'PIN', 'OTP', 'MFA', '2FA', 'SSO', 'OAuth',
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
  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Hello', 'Hi', 'Regards', 'Best', 'Sincerely', 'Thanks',
  'Office', 'Project', 'Team', 'Department', 'Manager', 'Director',
  'Subject', 'From', 'To', 'CC', 'BCC', 'Re', 'Fwd',
];
const FRENCH_STOP_WORDS = new Set(STOP_WORDS_RAW.map((w) => w.toLowerCase()));
const isStopWord = (token: string): boolean => FRENCH_STOP_WORDS.has(token.toLowerCase());

const STOP_PHRASES = new Set([
  'american express', 'diners club', 'diners club international', 'jcb international',
  'union pay', 'unionpay',
  'google llc', 'google inc', 'meta platforms', 'open ai',
  'new york', 'new orleans', 'los angeles', 'san francisco', 'san diego', 'san jose',
  'las vegas', 'fort worth', 'long beach', 'el paso',
  'rio de janeiro', 'sao paulo', 'mexico city', 'cape town', 'hong kong',
  'kuala lumpur', 'tel aviv', 'abu dhabi', 'cote d ivoire', "cote d'ivoire",
]);
const isStopPhrase = (entity: string): boolean =>
  STOP_PHRASES.has(
    entity.toLowerCase().replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' ').trim(),
  );

const TITLE_PATTERNS = [
  'M\\.', 'Mme', 'Mlle', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof',
  'Monsieur', 'Madame', 'Mademoiselle',
];

const TITLE_REGEX = new RegExp(
  `(?:${TITLE_PATTERNS.join('|')})\\s+([A-Z][a-zàâäéèêëïîôùûüç]+(?:-[A-Z][a-zàâäéèêëïîôùûüç]+)?(?:\\s+(?:${NAME_PARTICLE}\\s*)?[A-Z][a-zàâäéèêëïîôùûüç]+(?:-[A-Z][a-zàâäéèêëïîôùûüç]+)?)?)`,
  'g',
);

const TITLE_PREFIX = /^(?:M\.|Mme|Mlle|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Maitre|Maître|Monsieur|Madame|Mademoiselle)\s+/;

const cleanEntity = (raw: string): string =>
  raw
    .replace(/\s*[([].*$/, '')
    .replace(/[,;:!?]+$/, '')
    .replace(TITLE_PREFIX, '')
    .trim();

export function detectPersons(text: string): NerMatch[] {
  const matches: NerMatch[] = [];
  const seen = new Set<string>();

  const doc = nlp(text);
  const peopleRaw = doc.people().out('array') as string[];
  const people = peopleRaw.map(cleanEntity).filter((p) => p.length >= 2);

  for (const person of people) {
    if (seen.has(person.toLowerCase())) continue;
    if (isStopPhrase(person)) {
      seen.add(person.toLowerCase());
      continue;
    }
    const tokens = person
      .split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter(Boolean);
    if (tokens.length === 0 || tokens.every((t) => isStopWord(t))) {
      seen.add(person.toLowerCase());
      continue;
    }
    if (tokens.length === 1) {
      const tok = tokens[0];
      if (isStopWord(tok) || !/^[A-ZÀ-Ö]/.test(tok)) {
        seen.add(person.toLowerCase());
        continue;
      }
    }

    let searchStart = 0;
    while (true) {
      const idx = text.indexOf(person, searchStart);
      if (idx === -1) break;
      matches.push({ value: person, startIndex: idx, endIndex: idx + person.length, type: 'person' });
      searchStart = idx + 1;
    }
    seen.add(person.toLowerCase());
  }

  let match;
  const frenchRegex = new RegExp(FRENCH_NAME_PATTERN.source, 'g');
  while ((match = frenchRegex.exec(text)) !== null) {
    const fullName = match[0];
    const firstName = match[1];
    const lastName = match[2];
    if (isStopWord(firstName) || isStopWord(lastName) || isStopPhrase(fullName)) continue;
    if (seen.has(fullName.toLowerCase())) continue;
    matches.push({
      value: fullName,
      startIndex: match.index,
      endIndex: match.index + fullName.length,
      type: 'person',
    });
    seen.add(fullName.toLowerCase());
  }

  const titleRegex = new RegExp(TITLE_REGEX.source, 'g');
  while ((match = titleRegex.exec(text)) !== null) {
    const name = match[1];
    if (!name || seen.has(name.toLowerCase())) continue;
    const nameTokens = name.split(/\s+/);
    if (nameTokens.every((t) => isStopWord(t)) || isStopPhrase(name)) continue;
    const nameStart = match.index + match[0].indexOf(name);
    matches.push({ value: name, startIndex: nameStart, endIndex: nameStart + name.length, type: 'person' });
    seen.add(name.toLowerCase());
  }

  return matches;
}

export function detectOrganizations(text: string): NerMatch[] {
  const matches: NerMatch[] = [];
  const seen = new Set<string>();

  const doc = nlp(text);
  const orgsRaw = doc.organizations().out('array') as string[];
  const orgs = orgsRaw.map(cleanEntity).filter((o) => o.length >= 2);

  for (const org of orgs) {
    if (seen.has(org.toLowerCase())) continue;
    if (isStopPhrase(org)) {
      seen.add(org.toLowerCase());
      continue;
    }
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
      matches.push({ value: org, startIndex: idx, endIndex: idx + org.length, type: 'organization' });
      searchStart = idx + 1;
    }
    seen.add(org.toLowerCase());
  }

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

export function detectEntities(
  text: string,
  options: { persons?: boolean; organizations?: boolean } = { persons: true, organizations: true },
): NerMatch[] {
  const matches: NerMatch[] = [];
  if (options.persons) matches.push(...detectPersons(text));
  if (options.organizations) matches.push(...detectOrganizations(text));
  matches.sort((a, b) => a.startIndex - b.startIndex);
  return matches;
}
