import { listPublicMarketplaceListings } from './repository';
import {
  rankMarketplaceListings,
  type RankedMarketplaceListing,
} from './ranking-engine';
import { getMarketplaceTitleTerms } from '@/lib/marketplace/title-search';
import type { MarketplaceSearchState } from './search-state';

export type MarketplaceSearchEngineResult = {
  searchState: MarketplaceSearchState;
  candidateCount: number;
  ranked: RankedMarketplaceListing[];
  shown: RankedMarketplaceListing[];
  relaxedSuggestion?: string;
};

const internalCandidateLimit = 100;
const finalResultLimit = 6;

export function buildRetrievalTermGroups(state: MarketplaceSearchState) {
  return getMarketplaceTitleTerms([...state.terms, state.brand, state.model, state.color, ...state.requiredFeatures].filter(Boolean).join(' ')).map(term => [term]);
}

function getRelaxedSuggestion(state: MarketplaceSearchState) {
  if (state.maxPrice !== undefined) {
    return 'لا توجد نتائج قوية ضمن الميزانية الحالية. جرّب رفع الميزانية أو إزالة شرط السعر.';
  }

  if (state.city) {
    return 'لا توجد نتائج قوية في المدينة المحددة. جرّب توسيع البحث إلى مدن قريبة.';
  }

  if (state.yearMin !== undefined) {
    return 'لا توجد نتائج قوية للموديل المطلوب. جرّب تخفيف شرط السنة.';
  }

  return 'لا توجد نتائج قوية حاليًا. جرّب وصف المنتج بطريقة أبسط أو أوسع.';
}

export async function retrieveAndRankMarketplaceListings(
  state: MarketplaceSearchState,
): Promise<MarketplaceSearchEngineResult> {
  const candidates = await listPublicMarketplaceListings({
    query: buildRetrievalTermGroups(state).flat().join(' '),
    category: state.category,
    city: state.city,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    condition: state.condition,
    yearMin: state.yearMin,
    yearMax: state.yearMax,
    mileageMin: state.mileageMin,
    mileageMax: state.mileageMax,
    excludedTerms: [...state.excludedFeatures, ...state.excludedColors],
    limit: internalCandidateLimit,
    sort: state.sortPreference,
  });
  const scores = rankMarketplaceListings(candidates, state, { literal: true, preserveMatches: true });
  const byId = new Map(scores.map(result => [result.listing.id, result]));
  // Database ordering and filters are authoritative; scores explain, not hide, matches.
  const ranked = candidates.map(listing => byId.get(listing.id)!);

  return {
    searchState: state,
    candidateCount: candidates.length,
    ranked,
    shown: ranked.slice(0, finalResultLimit),
    relaxedSuggestion: ranked.length === 0 ? getRelaxedSuggestion(state) : undefined,
  };
}
