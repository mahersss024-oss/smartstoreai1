import { retrieveAndRankMarketplaceListings } from './retrieval-engine';
import {
  analyzeMarketForRankedListings,
  type ListingMarketIntelligence,
} from './market-intelligence';
import {
  buildMarketplaceRecommendations,
  type MarketplaceRecommendation,
} from './recommendation-engine';
import {
  updateMarketplaceSearchState,
  type MarketplaceSearchState,
} from './search-state';
import {
  rankingPreferenceSchema,
  sortPreferenceSchema,
  structuredSearchIntentSchema,
  parseStructuredSearchIntent,
  type StructuredSearchIntent,
} from './structured-search-intent';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import { z } from 'zod';

export type StatefulMarketplaceSearchResult = Awaited<
  ReturnType<typeof searchMarketplaceWithState>
>;

export const marketplaceSearchUnderstandingSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  yearMin: z.number().int().min(1900).max(2099).optional(),
  yearMax: z.number().int().min(1900).max(2099).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  mileageMin: z.number().int().nonnegative().optional(),
  mileageMax: z.number().int().nonnegative().optional(),
  color: z.string().trim().min(1).max(80).optional(),
  requiredFeatures: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  excludedFeatures: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  excludedColors: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  rankingPreferences: z.array(rankingPreferenceSchema).max(8).optional(),
  sortPreference: sortPreferenceSchema.optional(),
  locationPreference: z.enum(['same_city', 'nearby', 'anywhere']).optional(),
  descriptiveTerms: z
    .array(z.string().trim().min(1).max(80))
    .max(8)
    .describe(
      'Concrete product descriptors that are not represented by structured fields. Never pass search intent words or the full user sentence.',
    )
    .optional(),
});

export type MarketplaceSearchUnderstandingInput = z.infer<
  typeof marketplaceSearchUnderstandingSchema
>;

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function hasUnderstoodIntent(input: MarketplaceSearchUnderstandingInput | undefined) {
  if (!input) {
    return false;
  }

  return Object.values(input).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined,
  );
}

function mergeSearchUnderstanding(
  parsed: StructuredSearchIntent,
  understoodIntent?: MarketplaceSearchUnderstandingInput,
): StructuredSearchIntent {
  const parsedUnderstanding = marketplaceSearchUnderstandingSchema.safeParse(
    understoodIntent,
  );
  const understood = parsedUnderstanding.success ? parsedUnderstanding.data : undefined;
  const useUnderstoodTerms = hasUnderstoodIntent(understood);
  const hasStructuredProductIdentity = Boolean(
    understood?.brand ?? understood?.model ?? parsed.brand ?? parsed.model,
  );
  const parsedTerms =
    useUnderstoodTerms || hasStructuredProductIdentity ? [] : parsed.terms;

  return structuredSearchIntentSchema.parse({
    ...parsed,
    category: understood?.category ?? parsed.category,
    brand: understood?.brand ?? parsed.brand,
    model: understood?.model ?? parsed.model,
    city: understood?.city ?? parsed.city,
    minPrice: understood?.minPrice ?? parsed.minPrice,
    maxPrice: understood?.maxPrice ?? parsed.maxPrice,
    yearMin: understood?.yearMin ?? parsed.yearMin,
    yearMax: understood?.yearMax ?? parsed.yearMax,
    condition: understood?.condition ?? parsed.condition,
    mileageMin: understood?.mileageMin ?? parsed.mileageMin,
    mileageMax: understood?.mileageMax ?? parsed.mileageMax,
    color: understood?.color ?? parsed.color,
    requiredFeatures: uniqueStrings([
      ...parsed.requiredFeatures,
      ...(understood?.requiredFeatures ?? []),
    ]),
    excludedFeatures: uniqueStrings([
      ...parsed.excludedFeatures,
      ...(understood?.excludedFeatures ?? []),
    ]),
    excludedColors: uniqueStrings([
      ...parsed.excludedColors,
      ...(understood?.excludedColors ?? []),
    ]),
    rankingPreferences: uniqueStrings([
      ...parsed.rankingPreferences,
      ...(understood?.rankingPreferences ?? []),
    ]),
    sortPreference: understood?.sortPreference ?? parsed.sortPreference,
    locationPreference:
      understood?.locationPreference ?? parsed.locationPreference,
    terms: uniqueStrings([
      ...parsedTerms,
      ...(understood?.descriptiveTerms ?? []),
    ]),
  });
}

function summarizeMarket(
  market: Map<string, ListingMarketIntelligence>,
  listingIds: string[],
) {
  return Object.fromEntries(
    listingIds
      .map((listingId) => [listingId, market.get(listingId)])
      .filter(
        (entry): entry is [string, ListingMarketIntelligence] =>
          Boolean(entry[1]),
      ),
  );
}

function summarizeRecommendations(recommendations: MarketplaceRecommendation[]) {
  return recommendations;
}

function summarizeSearchState(state: MarketplaceSearchState) {
  return {
    category: state.category,
    brand: state.brand,
    model: state.model,
    city: state.city,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    yearMin: state.yearMin,
    yearMax: state.yearMax,
    condition: state.condition,
    mileageMin: state.mileageMin,
    mileageMax: state.mileageMax,
    color: state.color,
    requiredFeatures: state.requiredFeatures,
    excludedFeatures: state.excludedFeatures,
    excludedColors: state.excludedColors,
    rankingPreferences: state.rankingPreferences,
    sortPreference: state.sortPreference,
    revision: state.revision,
  };
}

export async function searchMarketplaceWithState(input: {
  ownerKey: string;
  query?: string;
  understoodIntent?: MarketplaceSearchUnderstandingInput;
}) {
  const intent = mergeSearchUnderstanding(
    parseStructuredSearchIntent(input.query),
    input.understoodIntent,
  );
  const searchState = await updateMarketplaceSearchState(input.ownerKey, intent);
  const results = await retrieveAndRankMarketplaceListings(searchState);
  const market = analyzeMarketForRankedListings(
    results.ranked.map((result) => result.listing),
  );
  const recommendations = buildMarketplaceRecommendations(results.shown, market);
  const visibleListingIds = results.shown.map((result) => result.listing.id);

  if (input.ownerKey.startsWith('user:')) {
    const userId = input.ownerKey.slice('user:'.length);

    if (userId) {
      try {
        publishRealtimeEvent({
          type: 'ai_results_updated',
          payload: {
            ownerKey: input.ownerKey,
            query: input.query,
          },
          visibility: {
            userIds: [userId],
          },
        });
      } catch {
        // Search should remain successful even if realtime publish fails.
      }
    }
  }

  return {
    status: 'searched' as const,
    searchState: summarizeSearchState(searchState),
    candidateCount: results.candidateCount,
    rankedCount: results.ranked.length,
    listings: results.shown,
    recommendations: summarizeRecommendations(recommendations),
    market: summarizeMarket(market, visibleListingIds),
    relaxedSuggestion: results.relaxedSuggestion,
  };
}
