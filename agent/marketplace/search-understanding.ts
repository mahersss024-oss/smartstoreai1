import { generateText } from 'ai';
import { z } from 'zod';

import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import type { AppLanguage } from '@/app/i18n';

import {
  marketplaceSearchUnderstandingSchema,
  type MarketplaceSearchUnderstandingInput,
} from './search-understanding-schema';

const searchUnderstandingTimeoutMs = 6_000;

const confidenceSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace('%', ''));

    if (Number.isFinite(parsed)) {
      return parsed > 1 ? parsed / 100 : parsed;
    }
  }

  if (typeof value === 'number' && value > 1 && value <= 100) {
    return value / 100;
  }

  return value;
}, z.number().min(0).max(1).default(0.6));

const searchUnderstandingModelSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;

  return {
    ...candidate,
    minPrice: candidate.minPrice ?? candidate.min_price,
    maxPrice: candidate.maxPrice ?? candidate.max_price,
    searchMode:
      candidate.searchMode ??
      candidate.search_mode ??
      candidate.mode ??
      candidate.merge_mode,
    yearMin: candidate.yearMin ?? candidate.year_min,
    yearMax: candidate.yearMax ?? candidate.year_max,
    mileageMin: candidate.mileageMin ?? candidate.mileage_min,
    mileageMax: candidate.mileageMax ?? candidate.mileage_max,
    requiredFeatures:
      candidate.requiredFeatures ?? candidate.required_features,
    excludedFeatures:
      candidate.excludedFeatures ?? candidate.excluded_features,
    excludedColors: candidate.excludedColors ?? candidate.excluded_colors,
    rankingPreferences:
      candidate.rankingPreferences ?? candidate.ranking_preferences,
    sortPreference: candidate.sortPreference ?? candidate.sort_preference,
    locationPreference:
      candidate.locationPreference ?? candidate.location_preference,
    descriptiveTerms:
      candidate.descriptiveTerms ??
      candidate.descriptive_terms ??
      candidate.product_descriptors,
    confidence: candidate.confidence ?? candidate.score ?? candidate.probability,
  };
}, marketplaceSearchUnderstandingSchema.extend({
  confidence: confidenceSchema,
}));

function extractJsonObject(text: string) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Search understanding model did not return JSON.');
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function mergeUnderstanding(
  base: MarketplaceSearchUnderstandingInput | undefined,
  next: MarketplaceSearchUnderstandingInput | undefined,
): MarketplaceSearchUnderstandingInput | undefined {
  if (!base && !next) {
    return undefined;
  }

  return {
    category: next?.category ?? base?.category,
    searchMode: next?.searchMode ?? base?.searchMode,
    brand: next?.brand ?? base?.brand,
    model: next?.model ?? base?.model,
    city: next?.city ?? base?.city,
    minPrice: next?.minPrice ?? base?.minPrice,
    maxPrice: next?.maxPrice ?? base?.maxPrice,
    yearMin: next?.yearMin ?? base?.yearMin,
    yearMax: next?.yearMax ?? base?.yearMax,
    condition: next?.condition ?? base?.condition,
    mileageMin: next?.mileageMin ?? base?.mileageMin,
    mileageMax: next?.mileageMax ?? base?.mileageMax,
    color: next?.color ?? base?.color,
    requiredFeatures: uniqueStrings([
      ...(base?.requiredFeatures ?? []),
      ...(next?.requiredFeatures ?? []),
    ]),
    excludedFeatures: uniqueStrings([
      ...(base?.excludedFeatures ?? []),
      ...(next?.excludedFeatures ?? []),
    ]),
    excludedColors: uniqueStrings([
      ...(base?.excludedColors ?? []),
      ...(next?.excludedColors ?? []),
    ]),
    rankingPreferences: uniqueStrings([
      ...(base?.rankingPreferences ?? []),
      ...(next?.rankingPreferences ?? []),
    ]) as MarketplaceSearchUnderstandingInput['rankingPreferences'],
    sortPreference: next?.sortPreference ?? base?.sortPreference,
    locationPreference: next?.locationPreference ?? base?.locationPreference,
    descriptiveTerms: uniqueStrings([
      ...(base?.descriptiveTerms ?? []),
      ...(next?.descriptiveTerms ?? []),
    ]),
  };
}

function removeUndefinedValues(input: MarketplaceSearchUnderstandingInput) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as MarketplaceSearchUnderstandingInput;
}

export function parseMarketplaceSearchUnderstanding(
  text: string,
): MarketplaceSearchUnderstandingInput {
  const parsed = searchUnderstandingModelSchema.parse(
    JSON.parse(extractJsonObject(text)),
  );
  const understanding = { ...parsed };
  delete (
    understanding as MarketplaceSearchUnderstandingInput & {
      confidence?: number;
    }
  ).confidence;

  return removeUndefinedValues(understanding);
}

function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return run(controller.signal).finally(() => {
    clearTimeout(timeout);
  });
}

export async function resolveMarketplaceSearchUnderstanding({
  query,
  language,
  preliminaryUnderstanding,
}: {
  query?: string;
  language?: AppLanguage;
  preliminaryUnderstanding?: MarketplaceSearchUnderstandingInput;
}) {
  const trimmedQuery = query?.trim();

  if (!trimmedQuery) {
    return preliminaryUnderstanding;
  }

  try {
    const result = await withTimeout(searchUnderstandingTimeoutMs, (signal) =>
      generateText({
        model: getDeepseekChatModel('search'),
        maxOutputTokens: 480,
        abortSignal: signal,
        system: `You are the SmartStore AI search-understanding model.
Return JSON only. Do not answer the user.
Your only job is to understand a buyer's marketplace search request and convert it into structured search intent.
Understand Arabic, Saudi dialect, Arabizi, English brands/models, misspellings, short follow-ups, and mixed Arabic-English wording.
Do not copy the full user sentence into search terms.
Do not treat words like search, find, want, need, show me, listing, marketplace, SmartStore AI, ابحث, اريد, ابي, دور, اعلان, سوق, or منتج as product data.
Use structured fields whenever possible: category, brand, model, city, minPrice, maxPrice, yearMin, yearMax, condition, mileageMin, mileageMax, color, requiredFeatures, excludedFeatures, excludedColors, rankingPreferences, sortPreference, locationPreference.
Set searchMode="new_search" when the buyer starts a fresh search or asks broadly for a product/category such as "ابي سيارة". Set searchMode="refine" only when the buyer is clearly narrowing the existing results, such as adding budget, city, mileage, color, or "show cheaper".
Use descriptiveTerms only for concrete product descriptors that are not already represented by structured fields.
Never invent listings, sellers, prices, availability, or unsupported platform actions.
If the request is too broad, still return the safe structured signals you understand instead of asking a question. Language=${language ?? 'ar'}.`,
        prompt: JSON.stringify({
          required_json_schema: {
            category: 'optional marketplace category',
            searchMode: 'optional: new_search | refine',
            brand: 'optional brand, canonical when clear',
            model: 'optional product model, canonical when clear',
            city: 'optional city',
            minPrice: 'optional number',
            maxPrice: 'optional number',
            yearMin: 'optional integer 1900-2099',
            yearMax: 'optional integer 1900-2099',
            condition: 'optional: new | used | like_new | damaged',
            mileageMin: 'optional integer',
            mileageMax: 'optional integer',
            color: 'optional color',
            requiredFeatures: 'optional concrete required features array',
            excludedFeatures: 'optional concrete excluded features array',
            excludedColors: 'optional excluded colors array',
            rankingPreferences:
              'optional: relevance | price | location | condition | mileage | year | listing_quality | freshness | engagement',
            sortPreference:
              'optional: best_match | cheapest | newest | closest | best_condition | lowest_mileage',
            locationPreference: 'optional: same_city | nearby | anywhere',
            descriptiveTerms:
              'optional concrete product descriptors only, never search intent words',
            confidence: 'number from 0 to 1',
          },
          preliminary_understanding: preliminaryUnderstanding ?? null,
          buyer_request: trimmedQuery,
        }),
      }),
    );
    const modelUnderstanding = parseMarketplaceSearchUnderstanding(result.text);

    return mergeUnderstanding(preliminaryUnderstanding, modelUnderstanding);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[search_understanding] failure=${errorName}`);
    return preliminaryUnderstanding;
  }
}
