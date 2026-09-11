// Ported verbatim from Anonymum/src/utils/labelled-id.ts.
import type { CategoryType } from './types';

// Socle commun des packs d'identifiants nationaux.
//
// La quasi-totalité des identifiants administratifs francophones sont des
// suites de chiffres nues : « 12345678 » est un identifiant fiscal marocain,
// mais aussi un montant, un code postal étendu ou un numéro de commande. Les
// détecter « à la forme » produirait un déluge de faux positifs — le corpus de
// test contient justement « 112 », « 3939 », « 69002 », « 4.2.1 » et
// « 12 456,78 euros » qui doivent rester intacts.
//
// On n'accepte donc une valeur QUE si son LIBELLÉ l'annonce. C'est la même
// stratégie que national-ids.ts applique déjà au NAS canadien collé.

export interface LabelledIdMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

export interface LabelledIdRule {
  /** Mots-clés du libellé, en alternative de regex (déjà échappés). */
  label: string;
  /** Forme de la valeur, en regex. Ne doit contenir aucun groupe capturant. */
  value: string;
  category: CategoryType;
  /**
   * Nombre max de caractères tolérés entre le mot-clé et le séparateur, pour
   * absorber les parenthèses explicatives : « ICE (identifiant commun de
   * l'entreprise) : … ». 0 = le mot-clé doit toucher la valeur.
   */
  gap?: number;
  /** Le séparateur « : » est-il obligatoire ? Par défaut non. */
  requireSeparator?: boolean;
}

/**
 * Construit les deux écritures possibles d'un identifiant libellé :
 *   1. en ligne de formulaire — « Libellé (précision) : valeur »
 *   2. en prose — « … ICE 001234567000089, identifiant fiscal 12345678 … »
 * et ne retourne que l'étendue de la VALEUR, pour que le libellé reste lisible
 * dans le texte anonymisé.
 */
export function scanLabelledIds(text: string, rules: LabelledIdRule[]): LabelledIdMatch[] {
  const out: LabelledIdMatch[] = [];

  for (const rule of rules) {
    const gap = rule.gap ?? 40;
    // Le libellé peut être suivi d'une précision entre parenthèses ou d'un
    // qualificatif (« CNSS salarié », « CIN / CNIE »), puis du séparateur.
    const separator = rule.requireSeparator ? '[:=]' : '[:=]?';
    // Le lookbehind empêche la valeur de démarrer au milieu d'un mot : sans
    // lui, « …sous le numéro 552100554 » pouvait produire « o 552100 ».
    const patterns = [
      `(?:${rule.label})[^:\\n]{0,${gap}}${separator}[ \\t]*(?<![A-Za-z0-9])(${rule.value})`,
    ];
    if (!rule.requireSeparator) {
      // Forme en prose : le mot-clé touche la valeur, sans séparateur.
      patterns.push(`(?:${rule.label})[ \\t]+(?<![A-Za-z0-9])(${rule.value})`);
    }

    // Le LIBELLÉ doit être reconnu sans égard à la casse (« CIN », « cin »),
    // mais la VALEUR non : sous le drapeau /i, un « [A-Z] » accepte aussi les
    // minuscules, et le motif du RCS luxembourgeois (« [A-Z]\s?\d{4,6} »)
    // capturait « o 552100 » dans « …sous le numéro 552100554 ». On matche donc
    // en insensible à la casse, puis on REVALIDE la valeur en sensible.
    const strictValue = new RegExp(`^(?:${rule.value})$`);

    for (const pattern of patterns) {
      const re = new RegExp(pattern, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const value = m[1];
        if (value && strictValue.test(value)) {
          // Position réelle de la valeur : elle termine le match, donc on la
          // cherche depuis la fin pour ne pas tomber sur une répétition du
          // même motif à l'intérieur du libellé.
          const at = m.index + m[0].lastIndexOf(value);
          out.push({ value, startIndex: at, endIndex: at + value.length, category: rule.category });
        }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  return out;
}

/** Un mot-clé de contexte apparaît-il à portée de la position donnée ? */
export function hasContext(text: string, index: number, keyword: RegExp, radius = 60): boolean {
  return keyword.test(text.slice(Math.max(0, index - radius), index + radius));
}
