// Ported verbatim from Anonymum/src/utils/secret-heuristics.ts.
// Heuristiques « ce jeton est-il un secret ? ».
//
// Le détecteur de mot de passe sans libellé doit trancher sur le JETON seul.
// L'ancienne version posait ses conditions en lookahead `[^\s]*…`, qui balaye
// tout ce qui suit jusqu'à la prochaine espace : sur une ligne CSV
// (« 004821,Moreau-Delacroix,Jean-Baptiste,1985-03-14,FR,+33612345678,… ») il
// n'y a AUCUNE espace, donc chaque jeton « voyait » la majuscule, la minuscule,
// le chiffre et le caractère spécial des colonnes voisines. Résultat : des noms
// (« Vandenberghe »), des dates (« 1985-03-14 ») et des identifiants nationaux
// étaient étiquetés PASSWORD — et anonymisés sous la mauvaise catégorie.
//
// On sépare donc la reconnaissance (regex de candidat, volontairement large) de
// la décision (ce prédicat, qui n'examine que le jeton).

// Caractères qu'un mot de passe peut contenir. `.`, `_` et `-` sont admis parce
// qu'ils sont courants dans les mots de passe générés, mais ils ne comptent PAS
// comme « caractère spécial » : sinon « Moreau-Delacroix » passerait.
const CANDIDATE = /(?<![A-Za-z0-9!#$%^&*?+=~._@\\/-])[A-Za-z0-9!#$%^&*?+=~._-]{8,64}(?![A-Za-z0-9!#$%^&*?+=~@\\/-])/g;

// Formes qui ressemblent à un jeton fort mais n'en sont pas.
const LOOKS_LIKE_DATE = /^\d{2,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;
const LOOKS_LIKE_VERSION = /^v?\d+(?:\.\d+){1,3}$/;

/**
 * Un jeton est un secret « fort » s'il mélange, DANS LE JETON LUI-MÊME, une
 * majuscule, une minuscule, un chiffre et un caractère spécial suivi d'un
 * alphanumérique (un « ! » final de phrase ne compte pas).
 */
export function isStrongSecretToken(token: string): boolean {
  if (token.length < 8 || token.length > 64) return false;
  if (LOOKS_LIKE_DATE.test(token) || LOOKS_LIKE_VERSION.test(token)) return false;
  if (!/[A-Z]/.test(token)) return false;
  if (!/[a-z]/.test(token)) return false;
  if (!/\d/.test(token)) return false;
  // Le spécial doit être suivi d'un alphanumérique : « Hiver!2026Neige » oui,
  // « Bonjour2026! » (ponctuation de fin) non.
  if (!/[!#$%^&*?+=~][A-Za-z0-9]/.test(token)) return false;
  // Le premier caractère doit être alphanumérique : « #992-BDate » est un
  // marqueur de numéro, pas un secret.
  if (!/^[A-Za-z0-9]/.test(token)) return false;
  return true;
}

export interface SecretMatch {
  value: string;
  startIndex: number;
  endIndex: number;
}

/** Jetons « en forme de mot de passe » mentionnés sans libellé adjacent. */
export function findStrongSecretTokens(text: string): SecretMatch[] {
  const out: SecretMatch[] = [];
  CANDIDATE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CANDIDATE.exec(text)) !== null) {
    if (isStrongSecretToken(m[0])) {
      out.push({ value: m[0], startIndex: m.index, endIndex: m.index + m[0].length });
    }
    if (m.index === CANDIDATE.lastIndex) CANDIDATE.lastIndex++;
  }
  return out;
}
