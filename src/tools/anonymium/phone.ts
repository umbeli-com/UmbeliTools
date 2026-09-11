// Ported from Anonymum/src/utils/phone.ts.
//
// The app takes libphonenumber-js as a hard dependency and unions its
// `findNumbers` output with the hand-written PHONE_REGEX, so international
// formats ("+49 30 12345678", "+81 3-1234-5678") are extracted AND validated.
// This service does not have that package yet, and package.json is not mine to
// edit — so the import is lazy and guarded:
//   * with libphonenumber-js installed, behaviour is identical to the app's;
//   * without it, phone detection falls back to the regex branch alone, which
//     is exactly the coverage this fork already had. Never a hard failure.
// See the `newDependencies` note in the handover.

export interface PhoneRange {
  value: string;
  startIndex: number;
  endIndex: number;
}

interface FoundNumber {
  startsAt: number;
  endsAt: number;
}

type FindNumbersFn = (
  text: string,
  options: { defaultCountry?: string; v2: true },
) => FoundNumber[];

let resolved = false;
let findNumbersImpl: FindNumbersFn | null = null;

function loadFindNumbers(): FindNumbersFn | null {
  if (resolved) return findNumbersImpl;
  resolved = true;
  try {
    // Runtime-optional: `require` (not `import`) so the build does not need the
    // package present, and a missing module degrades instead of throwing.
    const mod = require('libphonenumber-js');
    findNumbersImpl = typeof mod?.findNumbers === 'function' ? (mod.findNumbers as FindNumbersFn) : null;
  } catch {
    findNumbersImpl = null;
  }
  return findNumbersImpl;
}

/** Is the international phone parser available in this deployment? */
export function hasIntlPhoneParser(): boolean {
  return loadFindNumbers() !== null;
}

/**
 * International phone numbers, via libphonenumber-js when available.
 * `region` parses numbers written in a LOCAL format; only numbers carrying an
 * explicit `+` are kept, because otherwise findNumbers claims any ~10-digit run
 * (e.g. "2026-458921" inside a file number) and fragments other detections.
 */
export function detectPhoneNumbers(text: string, region: string = 'CA'): PhoneRange[] {
  const findNumbers = loadFindNumbers();
  if (!findNumbers) return [];
  try {
    const found = findNumbers(text, { defaultCountry: region, v2: true });
    return found
      .map((f) => ({
        value: text.slice(f.startsAt, f.endsAt),
        startIndex: f.startsAt,
        endIndex: f.endsAt,
      }))
      .filter((r) => r.value.includes('+'));
  } catch {
    return [];
  }
}
