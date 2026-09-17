import { normalizeMarketplaceSearchText } from './search';

/**
 * Central, extensible context lexicon for the forbidden terms checker.
 *
 * A handful of Arabic words are shared between a prohibited meaning and an
 * allowed one (e.g. "حشيش" = marijuana *and* animal fodder, "عرق" = a spirit
 * *and* a rare surname). Whole-word matching alone cannot separate them, so we
 * resolve the ambiguity with surrounding context words.
 *
 * Also holds the "derived colors" allowlist so color adjectives built on a
 * forbidden root (e.g. "خمري" from "خمر", "رصاصي" from "رصاص") are recognised
 * as colors rather than products.
 *
 * Everything here is plain, deterministic data. Adding a new word is a single
 * line. No network, no model, no behaviour change.
 */

function normalize(value: string) {
  return normalizeMarketplaceSearchText(value);
}

/**
 * Splits normalized text into word tokens once, shared by all context checks.
 */
function tokenizeNormalizedText(normalizedText: string) {
  return normalizedText.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const derivedColorValues = [
  'رصاصي',
  'خمري',
  'ذهبي',
  'فضي',
  'نبيتي',
  'برتقالي',
  'بنفسجي',
  'سماوي',
  'رمادي',
  'تركوازي',
  'كحلي',
  'وردي',
  'زيتي',
  'بيج',
  'بني',
  'فحمي',
  'عسلي',
  'نحاسي',
] as const;

const derivedColors = new Set(derivedColorValues.map(normalize));

/** True when a single word is a known derived color (e.g. "خمري"). */
export function isDerivedColorWord(word: string) {
  return derivedColors.has(normalize(word));
}

/**
 * Context words that make an ambiguous root allowed (e.g. "حشيش غنم").
 * Keyed by the ambiguous root, normalized.
 */
const allowedContextByRoot: Record<string, readonly string[]> = {
  // "حشيش" (marijuana) vs "حشيش" (animal fodder / grass).
  حشيش: [
    'غنم',
    'اغنام',
    'أغنام',
    'ابل',
    'إبل',
    'بقر',
    'ابقار',
    'أبقار',
    'خرفان',
    'عجل',
    'اغنام',
    'علف',
    'اعلاف',
    'أعلاف',
    'ثيل',
    'برسيم',
    'رودس',
    'مرعى',
    'مرعي',
    'ماشيه',
    'ماشية',
    'حيوان',
    'حيوانات',
    'دواجن',
    'طيور',
    'ارانب',
    'أرانب',
    'جمال',
    'سايق',
  ],
  // "كحول" (alcohol as a material) vs "كحول" (alcoholic drink). The word is a
  // legitimate ingredient in perfumes, cosmetics, and sanitizers, so the
  // prohibited meaning is only confirmed by drink-related context.
  كحول: [
    'عطر',
    'عطور',
    'برفان',
    'بيرفوم',
    'روائح',
    'تجميل',
    'مستحضر',
    'مستحضرات',
    'كوزمتك',
    'كولونيا',
    // Negation words ("خالي", "بدون", "غير") are intentionally NOT listed here;
    // they are handled by isRootNegated so "كحول غير طبيعي" is not misread as
    // "alcohol-free".
    'معقم',
    'مطهر',
    'مزيل',
    'شامبو',
    'غسول',
    'صابون',
    'كريم',
    'لوشن',
    'سكين',
    'معطر',
    'عطري',
    'طبي',
    'مطهرات',
    'معقمات',
    'تنظيف',
    'منظف',
    'منتجات',
    'منتج',
    'مانيكير',
    'مكياج',
    'مكياجي',
    'تجاري',
    'صناعي',
    'خال',
    'scent',
    'perfume',
    'fragrance',
  ],
  // "عرق" (a spirit, a distant given name) vs "عرق" (sweat / deodorant /
  // sciatica). The prohibited meaning is only confirmed by drink context.
  عرق: [
    'مزيل',
    'تعرق',
    'عرقان',
    'النسا',
    'نسا',
    'ابط',
    'إبط',
    'جفاف',
    'ملابس',
    'رياضي',
    'رياضه',
    'رياضة',
    'قصب',
    'حلوى',
    'سوس',
    'تسوس',
    'اسود',
    'أسود',
    'قناة',
    'معده',
    'معدة',
  ],
  // "دخان" (tobacco) vs "دخان" (physical smoke from an exhaust, fire, grill).
  // The prohibited meaning is only confirmed by tobacco context.
  دخان: [
    'عادم',
    'عوادم',
    'محرك',
    'محركات',
    'موتر',
    'سياره',
    'سيارة',
    'شاحنه',
    'شاحنة',
    'مركبه',
    'مركبة',
    'دراجه',
    'دراجة',
    'مصنع',
    'مدخنه',
    'مدخنة',
    'مداخن',
    'شواء',
    'فحم',
    'مشواة',
    'مشوى',
    'نار',
    'حريق',
    'حرائق',
    'بخار',
    'منقل',
    'جمر',
    'كهرباء',
    'تماس',
    'احتراق',
    'exhaust',
    'engine',
  ],
};

/**
 * Context words that confirm the prohibited meaning even when an allowed
 * context also exists (e.g. "حشيش مخدر للغنم" stays blocked).
 */
const blockedContextByRoot: Record<string, readonly string[]> = {
  حشيش: [
    'مخدر',
    'مخدرات',
    'سيكه',
    'سيكه',
    'كيف',
    'نشوه',
    'نشوة',
    'تدخين',
    'يدخن',
    'سيجاره',
    'سيجارة',
    'دخان',
    'شرب',
    'يشرب',
    'عشبه',
    'عشبة',
    'ماريخوانا',
    'ماريجوانا',
    'weed',
    'hashish',
    'marijuana',
  ],
  كحول: [
    'مشروب',
    'مشروبات',
    'شراب',
    'خمر',
    'خمور',
    'مسكر',
    'مسكرات',
    'سكر',
    'سكير',
    'سكران',
    'نبيذ',
    'ويسكي',
    'فودكا',
    'بيرة',
    'جعه',
    'شرب',
    'اشرب',
    'يشرب',
    'سقى',
    'يسقي',
    'drink',
    'liquor',
    'whisky',
    'vodka',
    'beer',
    'wine',
  ],
  عرق: [
    'مشروب',
    'شراب',
    'خمر',
    'مسكر',
    'سائل',
    'كاس',
    'كأس',
    'زجاجه',
    'زجاجة',
    'نبيذ',
  ],
  دخان: [
    'تبغ',
    'تبغيه',
    'سيجاره',
    'سيجارة',
    'سجائر',
    'شيشه',
    'شيشة',
    'معسل',
    'معسلات',
    'اركيله',
    'أركيلة',
    'فيب',
    'تدخين',
    'يدخن',
    'مدخن',
    'كرتون',
    'علبة',
    'توباكو',
    'نيكوتين',
    'tobacco',
    'cigarette',
    'vape',
  ],
};

function hasAnyContextWord(
  normalizedText: string,
  words: readonly string[],
) {
  const tokens = tokenizeNormalizedText(normalizedText);

  return words.some((word) => {
    const target = normalize(word);

    // Accept the bare word, its definite-article form ("غنم" / "الغنم"), and
    // its "لل" form ("للاغنام" -> "اغنام" / "الاغنام").
    const bareTarget = target.startsWith('ال') ? target.slice(2) : target;

    return tokens.some(
      (token) =>
        token === target ||
        token === `ال${target}` ||
        token === `ال${bareTarget}` ||
        token === `لل${bareTarget}`,
    );
  });
}

/**
 * Resolves an ambiguous root using its surrounding context.
 * Returns:
 *   - 'allowed'  when only allowed-context words are present
 *   - 'blocked'  when a blocked-context word is present
 *   - 'unknown'  when there is no decisive context
 */
/**
 * Ambiguous roots that share the same context lexicon. "كحولي" is an adjective
 * of "كحول", so both resolve against the same words.
 */
const contextRootAliases: Record<string, string> = {
  كحولي: 'كحول',
  عرق: 'عرق',
};

function resolveContextKey(root: string) {
  return contextRootAliases[root] ?? root;
}

/**
 * Negation words that mark a prohibited item as absent when used right before
 * an ambiguous root: "خالي من الكحول", "بدون كحول", "غير كحولي". A negated root
 * is resolved as allowed because the text explicitly states the item is not
 * present.
 */
const negationWords = [
  'خالي',
  'خاليه',
  'خالية',
  'بدون',
  'دون',
  'منزوع',
  'غير',
  'بلا',
  'خلا',
] as const;

/**
 * Returns true when the root is part of a genuine negation phrase, so the
 * prohibited item is stated to be absent:
 *   - "بدون كحول", "بلا كحول", "غير كحول"  (negation directly before the root)
 *   - "خالي من الكحول", "منزوع من الكحول"  (negation + "من" + root)
 *   - "كحول فري" forms are intentionally NOT treated as negation.
 *
 * The match is strict (adjacent, or separated only by "من") so evasion like
 * "بدون سبب كحول" is not misread as "alcohol-free".
 */
function isRootNegated(normalizedText: string, root: string) {
  const tokens = tokenizeNormalizedText(normalizedText);
  const normalizedRoot = normalize(root);
  const negationSet = new Set(negationWords.map(normalize));
  const connector = normalize('من');

  const isRootToken = (token: string) => {
    const bare = token.startsWith('ال') ? token.slice(2) : token;

    return (
      token === normalizedRoot ||
      token === `ال${normalizedRoot}` ||
      bare === normalizedRoot ||
      // Allow the adjective form ("كحولي" for root "كحول").
      bare.startsWith(normalizedRoot)
    );
  };

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isRootToken(tokens[index])) {
      continue;
    }

    const previous = tokens[index - 1];

    // "بدون كحول" / "غير كحولي"
    if (previous && negationSet.has(previous)) {
      return true;
    }

    // "خالي من الكحول" / "منزوع من الكحول"
    const beforePrevious = tokens[index - 2];

    if (
      previous === connector &&
      beforePrevious &&
      negationSet.has(beforePrevious)
    ) {
      return true;
    }
  }

  return false;
}

export function resolveAmbiguousRootContext(
  normalizedText: string,
  root: string,
): 'allowed' | 'blocked' | 'unknown' {
  const normalizedRoot = normalize(resolveContextKey(normalize(root)));
  const allowedWords = allowedContextByRoot[normalizedRoot];
  const blockedWords = blockedContextByRoot[normalizedRoot];

  if (!allowedWords && !blockedWords) {
    return 'unknown';
  }

  // A negated root ("خالي من الكحول") always means the prohibited item is not
  // the product, so it wins over any other context word.
  if (isRootNegated(normalizedText, normalizedRoot)) {
    return 'allowed';
  }

  if (blockedWords && hasAnyContextWord(normalizedText, blockedWords)) {
    return 'blocked';
  }

  if (allowedWords && hasAnyContextWord(normalizedText, allowedWords)) {
    return 'allowed';
  }

  return 'unknown';
}


