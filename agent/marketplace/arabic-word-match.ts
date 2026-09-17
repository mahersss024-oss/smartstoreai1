import { normalizeMarketplaceSearchText } from './search';

/**
 * Arabic-aware word matching used by the forbidden terms checker.
 *
 * The previous checker matched forbidden roots anywhere inside the text
 * (substring matching), which produced false positives such as:
 *   - "رصاصي" (a color) matched the ammunition root "رصاص"
 *   - "بندق" (hazelnut/nut) matched "بندقية" (rifle)
 *   - "شركة" (company) matched the shirk root "شرك"
 *   - "العراق" (a country) matched the alcohol root "عرق"
 *
 * This module normalizes each word with the shared marketplace normalizer and
 * matches a root only as a whole Arabic word with well-known prefixes/suffixes,
 * so a root never matches a different, longer word.
 */

// Shared Arabic prefixes that keep the underlying word meaning intact. Ordered
// from longest to shortest so compound prefixes ("بال", "وال", "وبال") are
// stripped before the single-letter ones.
const leadingPrefixes = [
  'وبال',
  'فبال',
  'وكال',
  'بال',
  'وال',
  'فال',
  'كال',
  'لال',
  'لل',
  'ال',
  'و',
  'ف',
  'ب',
  'ل',
  'ك',
] as const;

// Suffixes that only inflect the same word (number/gender/possessive/plural).
const inflectionalSuffixes = [
  'تين',
  'ات',
  'ون',
  'ين',
  'ان',
  'كم',
  'ها',
  'نا',
  'ية',
  'يه',
  'ه',
  'ك',
  'ي',
] as const;

// Suffixes that turn the matched root into a different, unrelated word.
// Example: "بندق" (hazelnut) + "ية" -> "بندقية" (rifle) must NOT match.
const defaultBlockedSuffixes = ['ية', 'يه', 'يات', 'يتين'] as const;

export type ArabicRootOptions = {
  /** Allow the definite article / single-letter prefixes before the root. */
  allowLeadingAl?: boolean;
  /** Suffixes that must never be accepted because they change the meaning. */
  blockedSuffixes?: readonly string[];
};

function normalizeWord(value: string) {
  return normalizeMarketplaceSearchText(value);
}

/**
 * Collapses non-letter separators that sit *between two Arabic letters* so
 * evasion attempts such as "ر-ص-ا-ص" or "حش.يش" collapse into a single word.
 * Spaces are left untouched so real word boundaries are preserved.
 */
function collapseLetterSeparators(value: string) {
  return value.replace(
    /(?<=\p{Script=Arabic})[^\p{L}\p{N}\s](?=\p{Script=Arabic})/gu,
    '',
  );
}

/**
 * Full display normalization: shared marketplace normalization plus collapsing
 * of intra-word separators. Used before tokenizing so both the inspected text
 * and the roots are compared on a level field.
 */
export function normalizeArabicDisplayText(value: string) {
  return normalizeWord(collapseLetterSeparators(value));
}

/**
 * Returns true when `word` is exactly the root or the root plus a leading
 * prefix and/or a single inflectional (meaning-preserving) suffix.
 */
function isRootWord(
  rawWord: string,
  normalizedRoot: string,
  options: ArabicRootOptions,
) {
  const word = normalizeWord(rawWord);

  if (!word || !word.includes(normalizedRoot)) {
    return false;
  }

  if (word === normalizedRoot) {
    return true;
  }

  const allowLeadingAl = options.allowLeadingAl ?? true;
  const blockedSuffixes = options.blockedSuffixes ?? defaultBlockedSuffixes;

  // When the definite article is disallowed (e.g. "عرق" vs "العراق"), remove
  // any prefix that contains "ال" from the candidate list.
  const prefixes = allowLeadingAl
    ? leadingPrefixes
    : leadingPrefixes.filter((prefix) => !prefix.includes('ال'));

  const bodies: string[] = [];

  if (word.startsWith(normalizedRoot)) {
    bodies.push(word.slice(normalizedRoot.length));
  }

  for (const prefix of prefixes) {
    if (word.startsWith(prefix)) {
      const withoutPrefix = word.slice(prefix.length);

      if (withoutPrefix.startsWith(normalizedRoot)) {
        bodies.push(withoutPrefix.slice(normalizedRoot.length));
      }
    }
  }

  return bodies.some((suffix) => {
    if (!suffix) {
      return true;
    }

    if (blockedSuffixes.some((blocked) => suffix.startsWith(blocked))) {
      return false;
    }

    return inflectionalSuffixes.some((allowed) => suffix === allowed);
  });
}

/**
 * Splits a text into word tokens after collapsing evasion separators. Spaces
 * and non-letter boundaries are treated as word separators.
 */
function tokenizeWords(text: string) {
  return normalizeArabicDisplayText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter(Boolean);
}

/**
 * Returns the matched word when the text contains the given root as a whole
 * word (allowing common prefixes/inflectional suffixes), otherwise null.
 */
export function findArabicRootMatch(
  text: string,
  root: string,
  options: ArabicRootOptions = {},
): string | null {
  const normalizedRoot = normalizeWord(root);

  if (!normalizedRoot) {
    return null;
  }

  return (
    tokenizeWords(text).find((word) =>
      isRootWord(word, normalizedRoot, options),
    ) ?? null
  );
}
