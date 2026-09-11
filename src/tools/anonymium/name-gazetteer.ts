// Ported verbatim from Anonymum/src/utils/name-gazetteer.ts.
// Gazetteer de prénoms — Phase 1 du renforcement NER.
// Objectif : détecter les PRÉNOMS SEULS (1 token) et fiabiliser les noms
// non-occidentaux, que le NER `compromise` rate (il vise surtout les noms
// complets EN). Liste curée multiculturelle.
//
// Curation : on EXCLUT volontairement les prénoms qui sont aussi des mots
// courants (Rose, Mark, Grace, Hope, May, Guy, Will…) pour limiter les faux
// positifs. Liste de départ — à enrichir (idéalement par dictionnaires par
// locale chargés à la demande).

const NAMES = [
  // Français
  'Jean', 'Pierre', 'Jacques', 'Michel', 'Philippe', 'Alain', 'Patrick', 'Nicolas',
  'Christophe', 'Laurent', 'Sébastien', 'Julien', 'David', 'Thomas', 'Antoine',
  'Marie', 'Sophie', 'Camille', 'Julie', 'Nathalie', 'Isabelle', 'Sylvie', 'Catherine',
  'Christine', 'Françoise', 'Hélène', 'Sandrine', 'Céline', 'Aurélie', 'Émilie',
  'Mathilde', 'Léa', 'Manon', 'Chloé', 'Clara', 'Inès', 'Jade', 'Louise',
  'Lucas', 'Hugo', 'Louis', 'Gabriel', 'Arthur', 'Jules', 'Léo', 'Nathan', 'Enzo',
  // Anglophones (sans mots-courants)
  'Robert', 'William', 'Richard', 'Charles', 'Joseph', 'Daniel', 'Matthew', 'Andrew',
  'Christopher', 'Anthony', 'Kevin', 'Brian', 'Steven', 'Edward', 'Ronald', 'Jason',
  'Jennifer', 'Jessica', 'Sarah', 'Karen', 'Nancy', 'Betty', 'Sandra', 'Ashley',
  'Emily', 'Michelle', 'Amanda', 'Melissa', 'Stephanie', 'Rebecca', 'Laura', 'Megan',
  // Hispanophones
  'José', 'Juan', 'Carlos', 'Luis', 'Miguel', 'Javier', 'Francisco', 'Alejandro',
  'Diego', 'Pablo', 'Sergio', 'Maria', 'Carmen', 'Josefa', 'Ana', 'Isabel',
  'Lucía', 'Elena', 'Sofía', 'Valentina', 'Mateo', 'Santiago',
  // Arabes / maghrébins
  'Mohammed', 'Ahmed', 'Ali', 'Omar', 'Youssef', 'Karim', 'Hassan', 'Khalid',
  'Mehdi', 'Bilal', 'Tarek', 'Samir', 'Rachid', 'Mustafa', 'Ibrahim', 'Yacine',
  'Aïcha', 'Fatima', 'Leila', 'Yasmine', 'Amina', 'Nadia', 'Salma', 'Sara', 'Imane',
  // Chinois / asiatiques (romanisés)
  'Wei', 'Ming', 'Jun', 'Hao', 'Lei', 'Yan', 'Feng', 'Chen', 'Xin', 'Tao',
  'Hiroshi', 'Takeshi', 'Yuki', 'Haruto', 'Sakura', 'Aiko', 'Kenji', 'Satoshi',
  'Min-jun', 'Seo-yeon', 'Ji-woo', 'Arjun', 'Priya', 'Raj', 'Anil', 'Deepak',
  // Africains
  'Kwame', 'Kofi', 'Chinedu', 'Emeka', 'Tunde', 'Sékou', 'Mamadou', 'Aminata',
  'Fatou', 'Oumar', 'Ousmane', 'Abdoulaye',
  // Slaves / Est-Europe
  'Ivan', 'Dmitri', 'Sergei', 'Vladimir', 'Alexei', 'Natasha', 'Olga', 'Katarina',
  'Andrei', 'Mikhail', 'Tatiana', 'Anastasia',
  // Italiens / portugais
  'Marco', 'Luca', 'Giuseppe', 'Lorenzo', 'Matteo', 'Francesca', 'Giulia', 'Chiara',
  'João', 'Tiago', 'Rui', 'Beatriz',
];

export const FIRST_NAMES: ReadonlySet<string> = new Set(NAMES.map((n) => n.toLowerCase()));

/** Vrai si le token (déjà sans ponctuation) est un prénom connu du gazetteer. */
export function isKnownFirstName(token: string): boolean {
  return FIRST_NAMES.has(token.toLowerCase());
}
