// Ported verbatim from Anonymum/src/utils/intl-street-address.ts.
import type { CategoryType } from './types';

// Adresses où la VOIE PRÉCÈDE le numéro.
//
// C'est la norme en Belgique, en Suisse et au Luxembourg — « Rue des Écoles 42,
// 6041 Gosselies » — alors que les détecteurs existants sont bâtis sur l'ordre
// français « 12 rue des Tilleuls ». Résultat : ces adresses étaient soit ratées,
// soit pire, découpées par le détecteur de personnes, qui prenait « Avenue
// Brugmann » ou « Rue du Rhône » pour un nom propre et laissait le numéro et le
// code postal en clair.
//
// Aucune de ces regexes n'utilise le drapeau /i : la capitale initiale de la
// voie et de la ville est précisément ce qui distingue une adresse d'une
// tournure comme « habite rue du Faubourg » (bloc de faux positifs du corpus),
// qui ne doit PAS être anonymisée faute de numéro et de code postal.

export interface StreetAddressMatch {
  value: string;
  startIndex: number;
  endIndex: number;
  category: CategoryType;
}

// Types de voie, dans leurs graphies belges, suisses et luxembourgeoises.
const VOIE =
  "(?:Rue|Avenue|Chemin|Boulevard|Place|Quai|Route|All[ée]e|Impasse|Clos|Dr[èe]ve|Chauss[ée]e|Sentier|Grand-Rue|Galerie|Square|Parvis|Mont[ée]e|Ruelle|Venelle|Esplanade)";

// Particules de liaison d'un nom de voie (« Rue des Écoles », « Chemin de la
// Forêt »). Non capitalisées, donc listées explicitement.
const LIAISON = "(?:de\\s+la|de\\s+l['’]|des|du|de|aux|au|la|le|l['’])";

// Un élément de nom de voie : capitale accentuée admise.
const MOT = "[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]*";

// Nom de ville : un ou plusieurs mots capitalisés, éventuellement composés.
const VILLE = "[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[- ][A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)*";

// Complément d'adresse belge : « boîte 3 », « bte 12 », « bus 4 ».
const BOITE = "(?:,\\s*(?:bo[îi]te|bte|bus|app\\.?|appartement)\\s*\\d+[A-Za-z]?)?";

// « Rue des Écoles 42, boîte 3, 6041 Gosselies » / « Chemin des Vignerons 7,
// 1095 Lutry » / « Avenue Brugmann 1180, 1180 Uccle ».
const VOIE_PUIS_NUMERO = new RegExp(
  `\\b${VOIE}(?:\\s+${LIAISON})*\\s+${MOT}(?:\\s+${MOT}){0,2}\\s+\\d{1,4}[a-zA-Z]?${BOITE},\\s*\\d{4}\\s+${VILLE}`,
  'g',
);

// Luxembourg : ordre français pour la voie, mais code postal préfixé « L- ».
// Sans cette règle, le détecteur d'adresses françaises s'arrêtait sur « L- » et
// produisait « [ADDRESS_5]1247 Luxembourg », laissant fuiter le code postal.
const ADRESSE_LU = new RegExp(
  `\\b\\d{1,4}(?:\\s?(?:bis|ter|quater))?,?\\s+(?:rue|avenue|boulevard|chemin|place|route|all[ée]e|impasse|grand-rue)\\s+[A-Za-zÀ-ÖØ-öø-ÿ'’ -]{2,40},\\s*L-\\d{4}\\s+${VILLE}`,
  'g',
);

export function detectIntlStreetAddresses(text: string): StreetAddressMatch[] {
  const out: StreetAddressMatch[] = [];
  const scan = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Une adresse ne consomme jamais la ponctuation ni l'espace qui la
      // terminent : sinon le placeholder se colle au mot suivant.
      const value = m[0].replace(/[\s.,;:]+$/, '');
      if (!value) continue;
      out.push({
        value,
        startIndex: m.index,
        endIndex: m.index + value.length,
        category: 'ADDRESS',
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };
  scan(VOIE_PUIS_NUMERO);
  scan(ADRESSE_LU);
  return out;
}
