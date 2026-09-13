import { z } from 'zod';

import {
  getMarketplaceSearchTermVariants,
  normalizeMarketplaceSearchText,
  parseMarketplaceSearchQuery,
} from './search';
import {
  vehicleBrandAliasEntries,
  vehicleModelAliasEntries,
} from './search-lexicon';
import type { ListingCondition } from './types';

export const rankingPreferenceSchema = z.enum([
  'relevance',
  'price',
  'location',
  'condition',
  'mileage',
  'year',
  'listing_quality',
  'freshness',
  'engagement',
]);

export const sortPreferenceSchema = z.enum([
  'best_match',
  'cheapest',
  'newest',
  'closest',
  'best_condition',
  'lowest_mileage',
]);

export const structuredSearchIntentSchema = z.object({
  intent: z.literal('search_listing').default('search_listing'),
  category: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  yearMin: z.number().int().min(1900).max(2099).optional(),
  yearMax: z.number().int().min(1900).max(2099).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  mileageMin: z.number().int().nonnegative().optional(),
  mileageMax: z.number().int().nonnegative().optional(),
  color: z.string().min(1).optional(),
  requiredFeatures: z.array(z.string().min(1)).default([]),
  excludedFeatures: z.array(z.string().min(1)).default([]),
  excludedColors: z.array(z.string().min(1)).default([]),
  rankingPreferences: z.array(rankingPreferenceSchema).default([]),
  sortPreference: sortPreferenceSchema.optional(),
  locationPreference: z.enum(['same_city', 'nearby', 'anywhere']).optional(),
  terms: z.array(z.string()).default([]),
  rawQuery: z.string().optional(),
});

export type StructuredSearchIntent = z.infer<typeof structuredSearchIntentSchema>;
export type RankingPreference = z.infer<typeof rankingPreferenceSchema>;
export type SortPreference = z.infer<typeof sortPreferenceSchema>;

const carModels = vehicleModelAliasEntries.map((entry) => ({
  patterns: entry.aliases,
  brand: entry.brand,
  model: entry.model,
}));

const brandMatchers = vehicleBrandAliasEntries.map((entry) => ({
  brand: entry.canonical,
  patterns: entry.aliases,
}));

const colorMatchers = [
  { value: 'أبيض', patterns: ['ابيض', 'أبيض', 'white'] },
  { value: 'أسود', patterns: ['اسود', 'أسود', 'black'] },
  { value: 'فضي', patterns: ['فضي', 'silver'] },
  { value: 'رمادي', patterns: ['رمادي', 'grey', 'gray'] },
  { value: 'أحمر', patterns: ['احمر', 'أحمر', 'red'] },
  { value: 'أزرق', patterns: ['ازرق', 'أزرق', 'blue'] },
  { value: 'ذهبي', patterns: ['ذهبي', 'gold'] },
  { value: 'بني', patterns: ['بني', 'brown'] },
];

const featureMatchers = [
  { value: 'hybrid', patterns: ['هايبرد', 'هجين', 'hybrid'] },
  { value: 'no_accident_history', patterns: ['بدون حوادث', 'لا يوجد حوادث', 'ما فيها حوادث'] },
  { value: 'clean', patterns: ['نظيف', 'نظيفة', 'ممتاز', 'ممتازة'] },
];

function includesAny(normalizedText: string, patterns: string[]) {
  return patterns.some((pattern) =>
    normalizedText.includes(normalizeMarketplaceSearchText(pattern)),
  );
}

function uniqueValues<T extends string>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function isIgnoredSearchTerm(term: string, ignoredTermValues: Set<string>) {
  const variants = getMarketplaceSearchTermVariants(term).map(
    normalizeMarketplaceSearchText,
  );

  return variants.some((variant) => ignoredTermValues.has(variant));
}

function parseMileage(normalizedText: string) {
  const numberPattern = '(\\d+(?:[,.]\\d+)?)';
  const unitPattern = '(الف|k|كم|كيلو)?';
  const explicitMax = normalizedText.match(
    new RegExp(`(?:ممشي|ممشاها|ماشيه|ماشية|كيلو|كم).{0,20}(?:تحت|اقل من|حدود)?\\s*${numberPattern}\\s*${unitPattern}`, 'iu'),
  );
  const underMileage = normalizedText.match(
    new RegExp(`(?:تحت|اقل من)\\s*${numberPattern}\\s*${unitPattern}\\s*(?:كم|كيلو)`, 'iu'),
  );
  const match = explicitMax ?? underMileage;

  if (!match) {
    return undefined;
  }

  const rawValue = Number((match[1] ?? '').replace(/[,\s٬]/g, ''));

  if (!Number.isFinite(rawValue)) {
    return undefined;
  }

  const unit = normalizeMarketplaceSearchText(match[2] ?? '');
  return Math.round(unit === 'الف' || unit === 'k' ? rawValue * 1000 : rawValue);
}

function parseCondition(normalizedText: string): ListingCondition | undefined {
  if (/(?:جديد|new)/i.test(normalizedText)) {
    return 'new';
  }

  if (/(?:كالجديد|كانه جديد|نظيف جدا|like new)/i.test(normalizedText)) {
    return 'like_new';
  }

  if (/(?:مستعمل|used)/i.test(normalizedText)) {
    return 'used';
  }

  if (/(?:تالف|مصدوم|به عيب|damaged)/i.test(normalizedText)) {
    return 'damaged';
  }

  return undefined;
}

function parseRankingPreferences(normalizedText: string): RankingPreference[] {
  const preferences: RankingPreference[] = [];

  if (/(?:ارخص|الأرخص|اقل سعر|اهم شي السعر|أهم شيء السعر|سعر)/i.test(normalizedText)) {
    preferences.push('price');
  }

  if (/(?:ممشي قليل|ممشى قليل|ممشاها قليل|اقل ممشي|أقل ممشى|low mileage)/i.test(normalizedText)) {
    preferences.push('mileage');
  }

  if (/(?:انظف|أنظف|نظيف|حالة ممتازة|الحاله|الحالة)/i.test(normalizedText)) {
    preferences.push('condition', 'listing_quality');
  }

  if (/(?:اقرب|أقرب|قريب|near|closest)/i.test(normalizedText)) {
    preferences.push('location');
  }

  if (/(?:احدث|أحدث|موديل احدث|newest)/i.test(normalizedText)) {
    preferences.push('year', 'freshness');
  }

  return uniqueValues(preferences);
}

function parseSortPreference(normalizedText: string): SortPreference | undefined {
  if (/(?:ارخص|الأرخص|اقل سعر|cheapest)/i.test(normalizedText)) {
    return 'cheapest';
  }

  if (/(?:اقرب|أقرب|closest)/i.test(normalizedText)) {
    return 'closest';
  }

  if (/(?:انظف|أنظف|افضل حاله|أفضل حالة)/i.test(normalizedText)) {
    return 'best_condition';
  }

  if (/(?:اقل ممشي|أقل ممشى|ممشي قليل|ممشى قليل|low mileage)/i.test(normalizedText)) {
    return 'lowest_mileage';
  }

  if (/(?:احدث|أحدث|newest)/i.test(normalizedText)) {
    return 'newest';
  }

  return undefined;
}

export function parseStructuredSearchIntent(query: string | null | undefined) {
  const rawQuery = query?.trim() ?? '';
  const normalizedText = normalizeMarketplaceSearchText(rawQuery);
  const parsed = parseMarketplaceSearchQuery(rawQuery);
  const modelMatch = carModels.find((candidate) =>
    includesAny(normalizedText, candidate.patterns),
  );
  const brandMatch =
    modelMatch ??
    brandMatchers.find((candidate) => includesAny(normalizedText, candidate.patterns));
  const mentionedColor = colorMatchers.find((candidate) =>
    includesAny(normalizedText, candidate.patterns),
  );
  const isColorExclusion =
    mentionedColor &&
    new RegExp(
      `(?:لا اريد|ما اريد|غير|بدون)\\s*${normalizeMarketplaceSearchText(mentionedColor.value)}`,
      'iu',
    ).test(normalizedText);
  const requiredFeatures = featureMatchers
    .filter((feature) => includesAny(normalizedText, feature.patterns))
    .map((feature) => feature.value);
  const excludedFeatures = [
    ...(/(?:بدون حوادث|لا يوجد حوادث|ما فيها حوادث)/i.test(normalizedText)
      ? ['accident_history']
      : []),
  ];
  const mileageValue = parseMileage(normalizedText);
  const ignoredTermValues = new Set([
    ...(brandMatch
      ? [
          brandMatch.brand,
          ...brandMatch.patterns,
          ...getMarketplaceSearchTermVariants(brandMatch.brand),
        ]
      : []),
    ...(modelMatch
      ? [
          modelMatch.model,
          ...modelMatch.patterns,
          ...getMarketplaceSearchTermVariants(modelMatch.model),
        ]
      : []),
    ...(mentionedColor?.patterns ?? []),
    'قليل',
    'قليله',
    'قليلة',
    'ممشي',
    'ممشى',
    'ممشاها',
    'ماشيه',
    'ماشية',
  ].map(normalizeMarketplaceSearchText));
  const terms = parsed.terms.filter(
    (term) => !isIgnoredSearchTerm(term, ignoredTermValues),
  );

  return structuredSearchIntentSchema.parse({
    intent: 'search_listing',
    category: parsed.category,
    brand: brandMatch?.brand,
    model: modelMatch?.model,
    city: parsed.city,
    minPrice: parsed.minPrice,
    maxPrice: parsed.maxPrice,
    yearMin: parsed.yearMin,
    yearMax: parsed.yearMax,
    condition: parseCondition(normalizedText),
    mileageMax: mileageValue,
    color: !isColorExclusion ? mentionedColor?.value : undefined,
    excludedColors: isColorExclusion && mentionedColor ? [mentionedColor.value] : [],
    requiredFeatures: uniqueValues(requiredFeatures),
    excludedFeatures: uniqueValues(excludedFeatures),
    rankingPreferences: parseRankingPreferences(normalizedText),
    sortPreference: parseSortPreference(normalizedText),
    locationPreference: parsed.city ? 'same_city' : undefined,
    terms,
    rawQuery,
  });
}
