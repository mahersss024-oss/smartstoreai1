import {
  marketplaceTermAliasEntries,
  vehicleBrandAliasEntries,
  vehicleModelAliasEntries,
  type SearchAliasEntry,
} from './search-lexicon';

export type ParsedMarketplaceSearchQuery = {
  category?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  yearMin?: number;
  yearMax?: number;
  terms: string[];
  termGroups: string[][];
};

const arabicDigitMap = new Map([
  ['٠', '0'],
  ['١', '1'],
  ['٢', '2'],
  ['٣', '3'],
  ['٤', '4'],
  ['٥', '5'],
  ['٦', '6'],
  ['٧', '7'],
  ['٨', '8'],
  ['٩', '9'],
]);

const searchStopWords = new Set([
  'ابحث',
  'أبحث',
  'بحث',
  'دور',
  'اريد',
  'أريد',
  'ابي',
  'أبي',
  'ابغى',
  'أبغى',
  'احتاج',
  'عن',
  'في',
  'من',
  'الى',
  'إلى',
  'على',
  'لي',
  'للبحث',
  'منتج',
  'منتجات',
  'اعلان',
  'إعلان',
  'الذكاء',
  'الاصطناعي',
  'مساعد',
  'ميزانية',
  'ميزانيه',
  'ميزانيتي',
  'حدي',
  'خل',
  'خلي',
  'غير',
  'الاهم',
  'الأهم',
  'اهم',
  'أهم',
  'شي',
  'شيء',
  'بحدود',
  'حدود',
  'بين',
  'تحت',
  'اقل',
  'أقل',
  'اكثر',
  'أكثر',
  'اكبر',
  'أكبر',
  'فوق',
  'ما',
  'يزيد',
  'اعلى',
  'أعلى',
  'حتى',
  'وفوق',
  'او',
  'أو',
  'احدث',
  'أحدث',
  'موديل',
  'ممشى',
  'ممشاها',
  'ماشيه',
  'ماشية',
  'كيلو',
  'كم',
  'الف',
  'ألف',
  'ريال',
  'ر',
  'س',
  'بيع',
  'للبيع',
  'شراء',
  'اشتري',
  'اشترى',
  'مطلوب',
  'اعرض',
  'أعرض',
  'اظهر',
  'أظهر',
  'وريني',
  'ارني',
  'أرني',
  'متوفر',
  'متوفره',
  'موجود',
  'موجوده',
  'فيه',
  'فيها',
  'حول',
  'يقبل',
  'search',
  'find',
  'looking',
  'for',
  'want',
  'buy',
  'need',
]);

const categoryMatchers: Array<{
  category: string;
  patterns: RegExp[];
  stopWords: string[];
}> = [
  {
    category: 'cars',
    patterns: [
      /(?:سيارة|سيارات|موتر|سياره|مواتر|كامري|كورولا|يارس|تويوتا|تايوتا|نيسان|هوندا|هيونداي|كيا|مازدا|لكزس|مرسيدس|car|cars|toyota|camry|corolla|sedan|suv)/i,
    ],
    stopWords: ['سيارة', 'سيارات', 'سياره', 'موتر', 'مواتر', 'car', 'cars'],
  },
  {
    category: 'mobile_phones',
    patterns: [/(?:جوال|جوالات|هاتف|ايفون|آيفون|سامسونج|iphone|samsung|phone|mobile)/i],
    stopWords: ['جوال', 'جوالات', 'هاتف', 'phone', 'mobile'],
  },
  {
    category: 'computers',
    patterns: [/(?:لابتوب|لاب توب|كمبيوتر|ماكبوك|macbook|laptop|computer)/i],
    stopWords: ['لابتوب', 'كمبيوتر', 'laptop', 'computer'],
  },
  {
    category: 'cameras',
    patterns: [/(?:كاميرا|كاميره|كاميرات|كانون|نيكون|فوجي|سوني الفا|camera|cameras|canon|nikon|fujifilm|sony alpha)/i],
    stopWords: ['كاميرا', 'كاميره', 'كاميرات', 'camera', 'cameras'],
  },
  {
    category: 'real_estate',
    patterns: [/(?:عقار|شقة|فيلا|بيت|ارض|أرض|real estate|apartment|villa|house)/i],
    stopWords: ['عقار', 'شقة', 'فيلا', 'بيت', 'ارض', 'أرض'],
  },
  {
    category: 'furniture',
    patterns: [/(?:اثاث|أثاث|كنب|كرسي|طاولة|furniture|chair|table|sofa)/i],
    stopWords: ['اثاث', 'أثاث', 'furniture'],
  },
];

const cityMatchers: Array<{ city: string; patterns: RegExp[]; stopWords: string[] }> = [
  {
    city: 'الرياض',
    patterns: [/(?:الرياض|رياض|riyadh)/i],
    stopWords: ['الرياض', 'رياض', 'riyadh'],
  },
  {
    city: 'جدة',
    patterns: [/(?:جدة|جده|jeddah)/i],
    stopWords: ['جدة', 'جده', 'jeddah'],
  },
  {
    city: 'الدمام',
    patterns: [/(?:الدمام|دمام|dammam)/i],
    stopWords: ['الدمام', 'دمام', 'dammam'],
  },
  {
    city: 'الخبر',
    patterns: [/(?:الخبر|خبر|khobar)/i],
    stopWords: ['الخبر', 'خبر', 'khobar'],
  },
  {
    city: 'مكة',
    patterns: [/(?:مكة|مكه|makkah|mecca)/i],
    stopWords: ['مكة', 'مكه', 'makkah', 'mecca'],
  },
  {
    city: 'المدينة',
    patterns: [/(?:المدينة|المدينه|medina)/i],
    stopWords: ['المدينة', 'المدينه', 'medina'],
  },
  {
    city: 'تبوك',
    patterns: [/(?:تبوك|tabuk)/i],
    stopWords: ['تبوك', 'tabuk'],
  },
  {
    city: 'أبها',
    patterns: [/(?:ابها|أبها|abha)/i],
    stopWords: ['ابها', 'أبها', 'abha'],
  },
  {
    city: 'الطائف',
    patterns: [/(?:الطائف|طايف|taif)/i],
    stopWords: ['الطائف', 'طايف', 'taif'],
  },
  {
    city: 'جازان',
    patterns: [/(?:جازان|جيزان|jazan|gizan)/i],
    stopWords: ['جازان', 'جيزان', 'jazan', 'gizan'],
  },
  {
    city: 'حائل',
    patterns: [/(?:حائل|حايل|hail|ha'il)/i],
    stopWords: ['حائل', 'حايل', 'hail'],
  },
  {
    city: 'بريدة',
    patterns: [/(?:بريدة|بريده|buraydah|buraidah)/i],
    stopWords: ['بريدة', 'بريده', 'buraydah', 'buraidah'],
  },
  {
    city: 'نجران',
    patterns: [/(?:نجران|najran)/i],
    stopWords: ['نجران', 'najran'],
  },
  {
    city: 'ينبع',
    patterns: [/(?:ينبع|yanbu)/i],
    stopWords: ['ينبع', 'yanbu'],
  },
  {
    city: 'الجبيل',
    patterns: [/(?:الجبيل|جبيل|jubail)/i],
    stopWords: ['الجبيل', 'جبيل', 'jubail'],
  },
  {
    city: 'الأحساء',
    patterns: [/(?:الاحساء|الأحساء|احساء|هفوف|hofuf|ahsa)/i],
    stopWords: ['الاحساء', 'الأحساء', 'احساء', 'هفوف', 'hofuf', 'ahsa'],
  },
];

function normalizeDigits(value: string) {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const mappedDigit = arabicDigitMap.get(digit);

    if (mappedDigit) {
      return mappedDigit;
    }

    const code = digit.charCodeAt(0);

    if (code >= 0x0660 && code <= 0x0669) {
      return String(code - 0x0660);
    }

    if (code >= 0x06f0 && code <= 0x06f9) {
      return String(code - 0x06f0);
    }

    return digit;
  });
}

export function normalizeMarketplaceSearchText(value: string) {
  return normalizeDigits(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[ء]/g, '')
    .replace(/[ک]/g, 'ك')
    .replace(/[ی]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getMarketplaceCitySearchVariants(city?: string) {
  const normalizedCity = normalizeMarketplaceSearchText(city ?? '');

  if (!normalizedCity) {
    return [];
  }

  const matchedCity = cityMatchers.find((matcher) => {
    if (normalizeMarketplaceSearchText(matcher.city) === normalizedCity) {
      return true;
    }

    return matcher.stopWords.some(
      (stopWord) => normalizeMarketplaceSearchText(stopWord) === normalizedCity,
    );
  });

  return uniqueValues(
    matchedCity ? [matchedCity.city, ...matchedCity.stopWords] : [city ?? ''],
  );
}

function tokenizeSearchQuery(query: string) {
  return normalizeMarketplaceSearchText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function buildSearchAliasMap(entries: SearchAliasEntry[]) {
  const aliases = new Map<string, string[]>();

  for (const entry of entries) {
    const values = uniqueValues([entry.canonical, ...entry.aliases]);

    for (const value of values) {
      aliases.set(normalizeMarketplaceSearchText(value), values);
    }
  }

  return aliases;
}

const termSynonyms = buildSearchAliasMap([
  ...marketplaceTermAliasEntries,
  ...vehicleBrandAliasEntries,
  ...vehicleModelAliasEntries,
]);

function isArabicSearchTerm(value: string) {
  return /\p{Script=Arabic}/u.test(value);
}

function getArabicArticleVariants(value: string) {
  const normalizedValue = normalizeMarketplaceSearchText(value);

  if (!normalizedValue || !isArabicSearchTerm(normalizedValue)) {
    return [value, normalizedValue];
  }

  const baseValues = [normalizedValue];

  if (normalizedValue.startsWith('و') && normalizedValue.length > 4) {
    baseValues.push(normalizedValue.slice(1));
  }

  const variants = [value, normalizedValue];

  for (const baseValue of baseValues) {
    variants.push(baseValue);

    if (baseValue.startsWith('ال') && baseValue.length > 4) {
      variants.push(baseValue.slice(2));
    } else {
      variants.push(`ال${baseValue}`);
    }

    if (baseValue.startsWith('لل') && baseValue.length > 4) {
      const withoutLamPrefix = baseValue.slice(2);
      variants.push(withoutLamPrefix, `ال${withoutLamPrefix}`);
    }
  }

  return uniqueValues(variants);
}

function getArabicEndingVariants(value: string) {
  const normalizedValue = normalizeMarketplaceSearchText(value);
  const variants = [value, normalizedValue];

  if (normalizedValue.endsWith('ه')) {
    variants.push(`${normalizedValue.slice(0, -1)}ة`);
  }

  if (value.endsWith('ة')) {
    variants.push(`${value.slice(0, -1)}ه`);
  }

  return uniqueValues(variants);
}

function parseNumberValue(value: string) {
  const numericValue = Number(value.replace(/[,\s٬]/g, ''));

  return Number.isFinite(numericValue) ? numericValue : null;
}

function isYearValue(value: number) {
  return value >= 1900 && value <= 2099;
}

function normalizePriceUnit(unit: string | undefined) {
  return normalizeMarketplaceSearchText(unit ?? '');
}

function toPriceAmount(value: string, unit: string | undefined) {
  const numberValue = parseNumberValue(value);

  if (numberValue === null) {
    return null;
  }

  const normalizedUnit = normalizePriceUnit(unit);

  if (normalizedUnit === 'الف' || normalizedUnit === 'k') {
    return Math.round(numberValue * 1000);
  }

  return numberValue;
}

function addConsumedTokens(consumedTokens: Set<string>, ...values: Array<string | undefined>) {
  for (const value of values) {
    const normalizedValue = normalizeMarketplaceSearchText(value ?? '');

    if (normalizedValue) {
      consumedTokens.add(normalizedValue);

      if (/^\d/.test(normalizedValue)) {
        consumedTokens.add(`و${normalizedValue}`);
      }
    }
  }
}

function isUsablePriceValue(value: number | null): value is number {
  return value !== null && !isYearValue(value) && value > 0;
}

function getPriceBounds(normalizedQuery: string) {
  const consumedTokens = new Set<string>();
  const numberPattern = '(\\d+(?:[,.]\\d+)?)';
  const unitPattern = '(الف|k|ريال|ر\\.?س|sar)';
  const rangeMatch = normalizedQuery.match(
    new RegExp(
      `(?:بين|من)\\s*${numberPattern}\\s*(?:${unitPattern})?\\s*(?:و|الي|حتى|-)\\s*${numberPattern}\\s*(?:${unitPattern})?`,
      'iu',
    ),
  );

  if (rangeMatch) {
    const firstUnit = rangeMatch[2];
    const secondUnit = rangeMatch[4];
    const lower = toPriceAmount(rangeMatch[1] ?? '', firstUnit ?? secondUnit);
    const upper = toPriceAmount(rangeMatch[3] ?? '', secondUnit ?? firstUnit);

    if (isUsablePriceValue(lower) && isUsablePriceValue(upper)) {
      addConsumedTokens(
        consumedTokens,
        rangeMatch[1],
        firstUnit,
        rangeMatch[3],
        secondUnit,
      );

      return {
        minPrice: Math.min(lower, upper),
        maxPrice: Math.max(lower, upper),
        consumedTokens,
      };
    }
  }

  const minPriceMatch = normalizedQuery.match(
    new RegExp(
      `(?:اكثر من|اكبر من|اعلى من|فوق|من)\\s*${numberPattern}\\s*(?:${unitPattern})?`,
      'iu',
    ),
  );
  const maxPriceMatch = normalizedQuery.match(
    new RegExp(
      `(?:ميزانيه|ميزانيتي|حدي|بحدود|حدود|اقل من|اقل|تحت|ما يزيد عن|حتى|الي)\\s*${numberPattern}\\s*(?:${unitPattern})?`,
      'iu',
    ),
  );
  const standaloneThousandMatch = normalizedQuery.match(
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${numberPattern}\\s*${unitPattern}(?:$|[^\\p{L}\\p{N}])`,
      'iu',
    ),
  );
  const standaloneLargeAmountMatch = normalizedQuery.match(
    /(?:^|[^\p{L}\p{N}])(\d{4,7})\s*(?:ريال|ر\.?س|sar)?(?:$|[^\p{L}\p{N}])/iu,
  );
  const minPrice = minPriceMatch
    ? toPriceAmount(minPriceMatch[1] ?? '', minPriceMatch[2])
    : null;
  const selectedMaxMatch =
    maxPriceMatch ?? standaloneThousandMatch ?? standaloneLargeAmountMatch;
  const maxPrice = selectedMaxMatch
    ? toPriceAmount(selectedMaxMatch[1] ?? '', selectedMaxMatch[2])
    : null;

  if (isUsablePriceValue(minPrice)) {
    addConsumedTokens(consumedTokens, minPriceMatch?.[1], minPriceMatch?.[2]);
  }

  if (isUsablePriceValue(maxPrice)) {
    addConsumedTokens(
      consumedTokens,
      selectedMaxMatch?.[1],
      selectedMaxMatch?.[2],
    );
  }

  if (!isUsablePriceValue(minPrice) && !isUsablePriceValue(maxPrice)) {
    return {
      consumedTokens: new Set<string>(),
    };
  }

  return {
    minPrice: isUsablePriceValue(minPrice) ? minPrice : undefined,
    maxPrice: isUsablePriceValue(maxPrice) ? maxPrice : undefined,
    consumedTokens,
  };
}

export function getMarketplaceSearchTermVariants(term: string) {
  const normalizedTerm = normalizeMarketplaceSearchText(term);
  const baseTerms = termSynonyms.get(normalizedTerm) ?? termSynonyms.get(term) ?? [term];
  const variants = uniqueValues([term, normalizedTerm, ...baseTerms]).flatMap(
    (baseTerm) =>
      getArabicArticleVariants(baseTerm).flatMap(getArabicEndingVariants),
  );

  return uniqueValues(variants.map(normalizeMarketplaceSearchText).concat(variants));
}

function getYearBounds(normalizedQuery: string) {
  const consumedTokens = new Set<string>();
  const yearPattern = '((?:19|20)\\d{2})';
  const minYearMatch = normalizedQuery.match(
    new RegExp(
      `${yearPattern}\\s*(?:(?:و|او)\\s*)?(?:فوق|احدث|اعلى|اكبر|بعد)`,
      'iu',
    ),
  );
  const maxYearMatch = normalizedQuery.match(
    new RegExp(`(?:قبل|اقدم|اقل من|تحت)\\s*${yearPattern}`, 'iu'),
  );
  const yearMin = minYearMatch ? Number.parseInt(minYearMatch[1] ?? '', 10) : undefined;
  const yearMax = maxYearMatch ? Number.parseInt(maxYearMatch[1] ?? '', 10) : undefined;

  if (yearMin) {
    addConsumedTokens(consumedTokens, minYearMatch?.[1]);
  }

  if (yearMax) {
    addConsumedTokens(consumedTokens, maxYearMatch?.[1]);
  }

  return {
    yearMin: Number.isFinite(yearMin) ? yearMin : undefined,
    yearMax: Number.isFinite(yearMax) ? yearMax : undefined,
    consumedTokens,
  };
}

export function parseMarketplaceSearchQuery(
  query: string | null | undefined,
): ParsedMarketplaceSearchQuery {
  const rawQuery = query?.trim() ?? '';
  const normalizedQuery = normalizeMarketplaceSearchText(rawQuery);

  if (!normalizedQuery) {
    return {
      terms: [],
      termGroups: [],
    };
  }

  const categoryRule = categoryMatchers.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(normalizedQuery)),
  );
  const cityRule = cityMatchers.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(normalizedQuery)),
  );
  const priceBounds = getPriceBounds(normalizedQuery);
  const yearBounds = getYearBounds(normalizedQuery);
  const ignoredTokens = new Set(
    [
      ...searchStopWords,
      ...(categoryRule?.stopWords ?? []),
      ...(cityRule?.stopWords ?? []),
    ].map(normalizeMarketplaceSearchText),
  );

  const terms = uniqueValues(
    tokenizeSearchQuery(normalizedQuery).filter(
      (token) =>
        token.length > 1 &&
        !ignoredTokens.has(token) &&
        !priceBounds.consumedTokens.has(token) &&
        !yearBounds.consumedTokens.has(token),
    ),
  );

  return {
    category: categoryRule?.category,
    city: cityRule?.city,
    minPrice: priceBounds.minPrice,
    maxPrice: priceBounds.maxPrice,
    yearMin: yearBounds.yearMin,
    yearMax: yearBounds.yearMax,
    terms,
    termGroups: terms.map(getMarketplaceSearchTermVariants),
  };
}
