// Ported verbatim from Anonymum/src/utils/addresses.ts.
import type { CategoryType } from './types';

// Pack d'adresses internationales (i18n Phase 3). Les adresses FR/CA/US sont
// déjà couvertes dans regex.ts ; on ajoute ici UK/DE/ES/IT.
// Stratégie low-FP : code postal UK détectable seul (structure distinctive
// lettre-chiffre-lettre) ; pour DE/ES/IT on exige une LIGNE complète (mot-clé
// de voie + numéro + code postal 5 chiffres + ville) — quasi zéro faux positif.

export interface AddressMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

// UK postcode : "SW1A 1AA", "M1 1AE", "EC1A 1BB".
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/g;

// Allemagne : "Hauptstraße 5, 10115 Berlin" (voie attachée au nom).
const DE_ADDRESS =
  /\b[A-ZÄÖÜ][a-zäöüß]+(?:stra(?:ß|ss)e|str\.|weg|allee|platz|gasse|ring)\s+\d{1,4}[a-z]?,?\s+\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+/g;

// Espagne : "Calle Mayor 10, 28013 Madrid".
const ES_ADDRESS =
  /\b(?:Calle|C\/|Avenida|Avda\.?|Av\.|Plaza|Paseo)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ ]+?\s+\d{1,4},?\s+\d{5}\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ-]+/g;

// Italie : "Via Roma 1, 00184 Roma".
const IT_ADDRESS =
  /\b(?:Via|Viale|Piazza|Corso|Vicolo)\s+[A-ZÀÈÉÌÒÙ][A-Za-zÀÈÉÌÒÙàèéìòù ]+?\s+\d{1,4},?\s+\d{5}\s+[A-ZÀÈÉÌÒÙ][A-Za-zÀÈÉÌÒÙàèéìòù-]+/g;

export function detectInternationalAddresses(text: string): AddressMatch[] {
  const out: AddressMatch[] = [];
  const scan = (re: RegExp, category: CategoryType) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ value: m[0], startIndex: m.index, endIndex: m.index + m[0].length, category });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };
  scan(UK_POSTCODE, 'POSTAL_CODE');
  scan(DE_ADDRESS, 'ADDRESS');
  scan(ES_ADDRESS, 'ADDRESS');
  scan(IT_ADDRESS, 'ADDRESS');
  return out;
}
