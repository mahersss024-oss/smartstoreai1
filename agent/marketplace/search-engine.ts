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
import { parseStructuredSearchIntent } from './structured-search-intent';

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
}) {
  const intent = parseStructuredSearchIntent(input.query);
  const searchState = await updateMarketplaceSearchState(input.ownerKey, intent);
  const results = await retrieveAndRankMarketplaceListings(searchState);
  const market = analyzeMarketForRankedListings(
    results.ranked.map((result) => result.listing),
  );
  const recommendations = buildMarketplaceRecommendations(results.shown, market);
  const visibleListingIds = results.shown.map((result) => result.listing.id);

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
