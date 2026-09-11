// Ported verbatim from Anonymum/src/utils/organizations-intl.ts.
import type { CategoryType } from './types';

// Raisons sociales et employeurs que les détecteurs français ne voyaient pas.
//
// Deux angles complémentaires :
//  1. la FORME JURIDIQUE — « Boiselec SRL » : la liste existante couvrait SARL,
//     SAS, SA… mais pas les formes belges, suisses, luxembourgeoises et
//     néerlandophones, si bien que la société du dossier médical restait en
//     clair à chaque occurrence.
//  2. le CONTEXTE D'EMPLOI — « travaille chez Hydro-Québec » : le nom d'un
//     employeur est un quasi-identifiant fort (il réduit la population à
//     quelques milliers de personnes), et aucune règle de forme ne peut
//     reconnaître un nom propre composé comme « Hydro-Québec ».

export interface OrganizationMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

// Formes juridiques : BE (SRL, SPRL, SComm, ASBL), NL (BV, NV, VZW), CH (Sàrl,
// SAgl, AG, GmbH), LU (Sàrl, SCA, SCS), DE/AT (GmbH, AG, KG, OHG), plus les
// formes internationales usuelles.
// Les formes nordiques (Oy, AB, A/S, ApS) sont volontairement absentes : hors
// périmètre francophone, et « AB » / « KG » apparaissent dans du texte courant.
const FORME_JURIDIQUE =
  '(?:S\\.?R\\.?L\\.?|SPRL|SComm|ASBL|VZW|B\\.?V\\.?|N\\.?V\\.?|S[àa]rl|SAgl|GmbH|OHG|SCA|SCS|SCRL|CVBA|BVBA|Ltd|LLC|PLC)';

// « Boiselec SRL », « Steinmann Conseil Sàrl », « Vandenberghe & Fils BV ».
// Le nom peut compter jusqu'à trois mots capitalisés, éventuellement liés par
// « & » ou une particule.
const RAISON_SOCIALE = new RegExp(
  `\\b[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’&-]*(?:\\s+(?:&|et|de|du|des)?\\s*[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’&-]*){0,2}\\s+${FORME_JURIDIQUE}(?![A-Za-z])`,
  'g',
);

// « travaille chez Hydro-Québec », « Employeur : Novatek Solutions ».
// Le « chez » NU est volontairement exclu : « commandé chez Fournisseur
// habituel », « rendez-vous chez Nous-Mêmes » produisaient de fausses
// organisations. Seules les tournures qui désignent explicitement un EMPLOYEUR
// sont retenues — c'est là que le nom devient un quasi-identifiant.
// L'article éventuel reste hors capture pour que la phrase demeure lisible.
const EMPLOYEUR = new RegExp(
  "\\b(?:employeur|employ[ée]e?\\s+(?:chez|par)|travaille\\s+(?:chez|pour)|salari[ée]e?\\s+(?:chez|de)|embauch[ée]e?\\s+(?:chez|par)|recrut[ée]e?\\s+(?:chez|par))\\s*[:=]?\\s*(?:l[ea]\\s+|l['’]\\s*)?([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[- ][A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]+){0,3})",
  'g',
);

// Pronoms et déterminants capitalisés en tête de phrase : jamais une raison
// sociale.
const PAS_UNE_ORG = /^(?:Nous|Vous|Ils|Elles|Elle|Lui|Eux|Soi|Moi|Toi|Notre|Votre|Leur|Cette|Cet|Ces|Mon|Ton|Son)\b/;

export function detectIntlOrganizations(text: string): OrganizationMatch[] {
  const out: OrganizationMatch[] = [];

  RAISON_SOCIALE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAISON_SOCIALE.exec(text)) !== null) {
    out.push({
      value: m[0],
      startIndex: m.index,
      endIndex: m.index + m[0].length,
      category: 'ORGANIZATION',
    });
    if (m.index === RAISON_SOCIALE.lastIndex) RAISON_SOCIALE.lastIndex++;
  }

  EMPLOYEUR.lastIndex = 0;
  while ((m = EMPLOYEUR.exec(text)) !== null) {
    const value = m[1];
    if (value && !PAS_UNE_ORG.test(value)) {
      const at = m.index + m[0].lastIndexOf(value);
      out.push({
        value,
        startIndex: at,
        endIndex: at + value.length,
        category: 'ORGANIZATION',
      });
    }
    if (m.index === EMPLOYEUR.lastIndex) EMPLOYEUR.lastIndex++;
  }

  return out;
}
