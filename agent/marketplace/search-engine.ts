import { retrieveAndRankMarketplaceListings } from './retrieval-engine';
import {
  analyzeListingMarket,
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
  parseExplicitMarketplaceSearchIntent,
} from './structured-search-intent';
import {
  marketplaceSearchUnderstandingSchema,
  type MarketplaceSearchUnderstandingInput,
} from './search-understanding-schema';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import type { AppLanguage } from '@/app/i18n';

export type StatefulMarketplaceSearchResult = Awaited<
  ReturnType<typeof searchMarketplaceWithState>
>;

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
    searchMode: state.searchMode,
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
  userId?: string;
  query?: string;
  understoodIntent?: MarketplaceSearchUnderstandingInput;
  language?: AppLanguage;
}) {
  const explicit = marketplaceSearchUnderstandingSchema.parse(input.understoodIntent ?? {});
  const intent = parseExplicitMarketplaceSearchIntent(input.query, explicit);
  const searchState = await updateMarketplaceSearchState(input.ownerKey, intent);
  const results = await retrieveAndRankMarketplaceListings(searchState);
  // Full semantic comparisons remain an explicit comparison/pricing service, not a search filter.
  const market = new Map(results.shown.map(({ listing }) => [listing.id, analyzeListingMarket(listing, [])]));
  const recommendations = buildMarketplaceRecommendations(results.shown, market);
  const visibleListingIds = results.shown.map((result) => result.listing.id);

  const userId = input.userId ?? (input.ownerKey.startsWith('user:')
    ? input.ownerKey.slice('user:'.length) : undefined);

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
