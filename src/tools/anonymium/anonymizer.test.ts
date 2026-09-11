import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anonymize, anonymizeMany, deanonymize } from './anonymizer';
import { mergeRanges } from './helpers';
import { DEFAULT_CONFIG } from './types';
import type { Detection } from './types';

// Run with:  npx tsx src/tools/anonymium/anonymizer.test.ts

const cfg = DEFAULT_CONFIG;

// The sentinel the previous anonymizeMany joined texts with. Kept here ONLY so
// the regression tests below can prove why it had to go.
const LEGACY_SEP = '\n@@@UMBELI_ANON_SEP@@@\n';
const legacyAnonymizeMany = (texts: string[]): string[] =>
  anonymize(texts.join(LEGACY_SEP), [], cfg).anonymizedText.split(LEGACY_SEP);

const det = (
  startIndex: number,
  endIndex: number,
  category: Detection['category'],
  source: Detection['source'],
): Detection => ({ id: `${category}-${startIndex}`, value: 'x', category, source, startIndex, endIndex });

// ---------------------------------------------------------------------------
// anonymizeMany: positional alignment
// ---------------------------------------------------------------------------

test('anonymizeMany returns exactly one output per input', () => {
  const texts = ['Bonjour Sophie', 'Rien de sensible ici', 'Appelle le (514) 555-0123'];
  const { anonymizedTexts } = anonymizeMany(texts, [], cfg);
  assert.equal(anonymizedTexts.length, texts.length);
  assert.match(anonymizedTexts[2], /\[PHONE_\d+\]/);
  // Slot 1 has nothing to mask and must come back untouched, not shifted.
  assert.equal(anonymizedTexts[1], 'Rien de sensible ici');
});

test('anonymizeMany: [] in, [] out', () => {
  assert.deepEqual(anonymizeMany([], [], cfg), { anonymizedTexts: [], mapping: [] });
});

test('regression: the legacy join/split strategy loses texts on ordinary input', () => {
  // HANDLE_REGEX (@[a-zA-Z0-9._-]{2,}) matches "@UMBELI_ANON_SEP" INSIDE the
  // sentinel, so every separator was rewritten to "[HANDLE_1]" before the
  // split — on EVERY call, with the default config. split() then found no
  // separator at all and returned a single blob: callers past index 0 received
  // `undefined`, and their content was still sitting inside the blob handed to
  // slot 0. That is the cross-record leak this rewrite removes.
  const texts = ['hello', 'world'];
  const legacy = legacyAnonymizeMany(texts);
  assert.equal(legacy.length, 1, 'the legacy strategy is expected to collapse the texts');
  assert.equal(legacy[1], undefined);

  const { anonymizedTexts } = anonymizeMany(texts, [], cfg);
  assert.equal(anonymizedTexts.length, 2);
  assert.deepEqual(anonymizedTexts, ['hello', 'world']);
});

test('regression: a detection overlapping the join boundary no longer merges two texts', () => {
  // PRIVATE_KEY_REGEX is non-greedy across newlines, so once joined, the BEGIN
  // block of text 0 and the END block of text 1 became ONE detection that ate
  // the separator with them.
  const texts = ['-----BEGIN PRIVATE KEY-----\nMIIabc', 'suite\n-----END PRIVATE KEY-----'];
  assert.notEqual(legacyAnonymizeMany(texts).length, texts.length);

  const { anonymizedTexts } = anonymizeMany(texts, [], cfg);
  assert.equal(anonymizedTexts.length, 2);
  assert.match(anonymizedTexts[0], /^\[API_KEY_\d+\]\nMIIabc$/);
  // Text 1 stays text 1: no part of text 0 bleeds into it.
  assert.ok(anonymizedTexts[1].includes('suite'));
  assert.ok(!anonymizedTexts[1].includes('MIIabc'));
});

test('regression: a text containing the sentinel cannot shift the other texts', () => {
  const texts = ['Alpha\n@@@UMBELI_ANON_SEP@@@\nBeta', 'Gamma: 514-555-0123'];
  const { anonymizedTexts } = anonymizeMany(texts, [], cfg);
  assert.equal(anonymizedTexts.length, 2);
  assert.ok(anonymizedTexts[0].startsWith('Alpha'));
  assert.ok(anonymizedTexts[1].startsWith('Gamma:'));
  assert.match(anonymizedTexts[1], /\[PHONE_\d+\]/);
});

test('anonymizeMany shares one mapping across texts', () => {
  const texts = [
    'Le dossier de Marie-Claire Bernard est ouvert.',
    'Relance : Marie-Claire Bernard doit signer.',
  ];
  const { anonymizedTexts, mapping } = anonymizeMany(texts, [], cfg);
  const tag = anonymizedTexts[0].match(/\[[A-Z_]+_\d+\]/)?.[0];
  assert.ok(tag, 'expected a placeholder in the first text');
  assert.ok(anonymizedTexts[1].includes(tag!), 'the same value must reuse the same placeholder');
  const entry = mapping.find((m) => m.placeholder === tag);
  assert.ok(entry);
  assert.equal(entry!.count, 2, 'the shared entry must count both occurrences');
});

test('anonymizeMany round-trips through deanonymize', () => {
  const texts = ['Écrire à jean.dupont@example.com', 'Rappeler jean.dupont@example.com demain'];
  const { anonymizedTexts, mapping } = anonymizeMany(texts, [], cfg);
  assert.ok(!anonymizedTexts.join(' ').includes('jean.dupont@example.com'));
  assert.deepEqual(anonymizedTexts.map((t) => deanonymize(t, mapping)), texts);
});

test('anonymizeMany fails loudly on a non-string entry instead of misaligning', () => {
  assert.throws(() => anonymizeMany(['ok', 42 as unknown as string], [], cfg), /texts\[1\] is not a string/);
  assert.throws(() => anonymizeMany('nope' as unknown as string[], [], cfg), /must be an array/);
});

// ---------------------------------------------------------------------------
// mergeRanges: an explicit Rule outranks a heuristic
// ---------------------------------------------------------------------------

test('mergeRanges: a manual Rule beats an overlapping regex hit of the same span', () => {
  const regexHit = det(0, 20, 'EMAIL', 'regex');
  const manual = det(0, 20, 'CLIENT', 'manual');
  const kept = mergeRanges([regexHit, manual]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].category, 'CLIENT');
  assert.equal(kept[0].source, 'manual');
  // Order of arrival must not decide the winner.
  assert.equal(mergeRanges([manual, regexHit])[0].source, 'manual');
});

test('mergeRanges: a manual Rule wins even when a longer NER hit contains it', () => {
  const nerHit = det(0, 30, 'PERSON', 'ner');
  const manual = det(10, 18, 'CUSTOM', 'manual');
  const kept = mergeRanges([nerHit, manual]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, 'manual');
  assert.equal(kept[0].category, 'CUSTOM');
});

test('mergeRanges: a manual Rule spanning two heuristic hits evicts both', () => {
  const kept = mergeRanges([det(0, 10, 'PERSON', 'ner'), det(12, 20, 'DATE', 'regex'), det(5, 15, 'CUSTOM', 'manual')]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, 'manual');
});

test('mergeRanges: between heuristics, category priority beats a longer low-priority span', () => {
  // A generic ID (priority 15) must not evict an API key (98) by being longer.
  const kept = mergeRanges([det(0, 40, 'ID', 'regex'), det(5, 35, 'API_KEY', 'regex')]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].category, 'API_KEY');
});

test('mergeRanges: equal priority falls back to the longer span, and gaps are preserved', () => {
  const kept = mergeRanges([det(0, 5, 'DATE', 'regex'), det(0, 9, 'DATE', 'regex'), det(20, 25, 'DATE', 'regex')]);
  assert.deepEqual(kept.map((k) => [k.startIndex, k.endIndex]), [[0, 9], [20, 25]]);
});

test('anonymize: a caller Rule wins over the EMAIL detector on the same span', () => {
  const text = 'Contact: sophie.tremblay@acme-corp.com';
  const rules = [{ term: 'sophie.tremblay@acme-corp.com', category: 'CLIENT' as const }];
  const result = anonymize(text, rules, cfg);
  assert.equal(result.anonymizedText, 'Contact: [CLIENT_1]');
  assert.equal(result.mapping.length, 1);
  assert.equal(result.mapping[0].category, 'CLIENT');
  assert.equal(result.mapping[0].source, 'manual');
  assert.equal(deanonymize(result.anonymizedText, result.mapping), text);
});

// ---------------------------------------------------------------------------
// Engine parity smoke tests — Quebec / Canada identifiers
// ---------------------------------------------------------------------------

const parity: Array<[string, string, RegExp]> = [
  ['NAS/SIN', 'Son NAS est 046 454 286.', /\[SIN_1\]/],
  ['RAMQ health card', "Carte d'assurance maladie : TREM 8501 1234", /\[HEALTH_CARD_1\]/],
  ['Canadian postal code', 'Il habite au H2J 2K9 depuis 2019.', /\[POSTAL_CODE_1\]/],
  ['Quebec plate', "Plaque d'immatriculation : K23 XPW", /\[LICENSE_PLATE_1\]/],
  ['NEQ', 'NEQ : 1234567890', /\[GOV_ID_1\]/],
  ['driver licence', 'Permis de conduire : T1234-567890-12', /\[DRIVER_LICENSE_1\]/],
  ['NIR (FR)', 'NIR : 2 85 09 69 123 456 78', /\[NIR_1\]/],
  ['QC street address', '1247, rue des Peupliers, bureau 305\nSherbrooke (Québec) J1H 4M2', /\[ADDRESS_1\]/],
  ['NA + FR phone', 'Appelle-moi au (514) 555-0123 ou au 06 12 34 56 78.', /\[PHONE_1\].*\[PHONE_2\]/],
];

for (const [label, text, expected] of parity) {
  test(`parity: ${label} is detected`, () => {
    const { anonymizedText } = anonymize(text, [], cfg);
    assert.match(anonymizedText, expected);
  });
}

test('parity: the raw identifier never survives in the output', () => {
  const text = 'NAS 046 454 286, carte TREM 8501 1234, code postal H2J 2K9.';
  const { anonymizedText } = anonymize(text, [], cfg);
  for (const secret of ['046 454 286', 'TREM 8501 1234', 'H2J 2K9']) {
    assert.ok(!anonymizedText.includes(secret), `${secret} leaked: ${anonymizedText}`);
  }
});
