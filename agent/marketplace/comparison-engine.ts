import {
  analyzeListingMarket,
  getComparableListings,
} from './market-intelligence';
import { rankMarketplaceListings } from './ranking-engine';
import type { MarketplaceSearchState } from './search-state';
import type { ListingRecord } from './store';

export type MarketplaceComparisonItem = {
  listing: ListingRecord;
  overallScore: number;
  priceScore: number;
  conditionScore: number;
  mileageScore: number;
  specsScore: number;
  locationScore: number;
  listingQualityScore: number;
  marketValueScore: number | null;
  labels: Array<
    'target' | 'best_overall' | 'best_value' | 'cheapest' | 'best_condition'
  >;
  reasons: string[];
};

export type MarketplaceComparisonResult = {
  target: MarketplaceComparisonItem;
  alternatives: MarketplaceComparisonItem[];
  marketSummary: ReturnType<typeof analyzeListingMarket>;
};

function comparisonStateFromListing(listing: ListingRecord): MarketplaceSearchState {
  return {
    intent: 'search_listing',
    category: listing.category,
    city: listing.city,
    maxPrice: typeof listing.price === 'number' ? listing.price * 1.25 : undefined,
    condition: listing.condition,
    requiredFeatures: [],
    excludedFeatures: [],
    excludedColors: [],
    rankingPreferences: ['relevance', 'price', 'condition', 'listing_quality'],
    sortPreference: 'best_match',
    terms: [listing.title ?? '', ...Object.values(listing.attributes).map(String)]
      .filter(Boolean)
      .slice(0, 8),
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
}

function numericPrice(item: MarketplaceComparisonItem) {
  return typeof item.listing.price === 'number'
    ? item.listing.price
    : Number.MAX_SAFE_INTEGER;
}

function addLabel(
  items: MarketplaceComparisonItem[],
  predicate: (items: MarketplaceComparisonItem[]) => MarketplaceComparisonItem | undefined,
  label: MarketplaceComparisonItem['labels'][number],
) {
  const item = predicate(items);

  if (item && !item.labels.includes(label)) {
    item.labels.push(label);
  }
}

export function compareMarketplaceListings(
  target: ListingRecord,
  candidates: ListingRecord[],
  limit = 6,
): MarketplaceComparisonResult {
  const comparableListings = getComparableListings(target, candidates).slice(0, 30);
  const comparisonSet = [target, ...comparableListings];
  const ranked = rankMarketplaceListings(
    comparisonSet,
    comparisonStateFromListing(target),
  );
  const marketSummary = analyzeListingMarket(target, comparableListings);
  const items: MarketplaceComparisonItem[] = ranked.map((result) => {
    const market = analyzeListingMarket(
      result.listing,
      getComparableListings(result.listing, comparisonSet),
    );

    return {
      listing: result.listing,
      overallScore: result.scores.finalScore,
      priceScore: result.scores.priceScore,
      conditionScore: result.scores.conditionScore,
      mileageScore: result.scores.mileageScore,
      specsScore: result.scores.specificationsScore,
      locationScore: result.scores.locationScore,
      listingQualityScore: result.scores.listingQualityScore,
      marketValueScore: market.marketValueScore,
      labels: result.listing.id === target.id ? ['target'] : [],
      reasons: result.reasons,
    };
  });

  addLabel(
    items,
    (currentItems) =>
      [...currentItems].sort((left, right) => right.overallScore - left.overallScore)[0],
    'best_overall',
  );
  addLabel(
    items,
    (currentItems) =>
      [...currentItems].sort((left, right) => numericPrice(left) - numericPrice(right))[0],
    'cheapest',
  );
  addLabel(
    items,
    (currentItems) =>
      [...currentItems].sort(
        (left, right) =>
          right.conditionScore +
          right.listingQualityScore -
          (left.conditionScore + left.listingQualityScore),
      )[0],
    'best_condition',
  );
  addLabel(
    items,
    (currentItems) =>
      [...currentItems].sort(
        (left, right) =>
          (right.marketValueScore ?? right.priceScore) -
          (left.marketValueScore ?? left.priceScore),
      )[0],
    'best_value',
  );

  const targetItem =
    items.find((item) => item.listing.id === target.id) ??
    ({
      listing: target,
      overallScore: 0,
      priceScore: 0,
      conditionScore: 0,
      mileageScore: 0,
      specsScore: 0,
      locationScore: 0,
      listingQualityScore: 0,
      marketValueScore: null,
      labels: ['target'],
      reasons: ['الإعلان المطلوب للمقارنة'],
    } satisfies MarketplaceComparisonItem);

  return {
    target: targetItem,
    alternatives: items
      .filter((item) => item.listing.id !== target.id)
      .slice(0, limit),
    marketSummary,
  };
}
