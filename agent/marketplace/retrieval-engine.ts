import { listMarketplaceListings } from './repository';
import {
  rankMarketplaceListings,
  type RankedMarketplaceListing,
} from './ranking-engine';
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
const featureSearchTerms = new Map([
  ['hybrid', ['hybrid', 'هايبرد', 'هجين']],
  ['clean', ['clean', 'نظيف', 'نظيفة', 'ممتاز', 'ممتازة']],
  ['no_accident_history', ['بدون حوادث', 'لا يوجد حوادث']],
]);

function buildRetrievalTermGroups(state: MarketplaceSearchState) {
  return [
    ...(state.brand ? [[state.brand]] : []),
    ...(state.model ? [[state.model]] : []),
    ...(state.color ? [[state.color]] : []),
    ...state.requiredFeatures.map(
      (feature) => featureSearchTerms.get(feature) ?? [feature],
    ),
    ...state.terms.map((term) => [term]),
  ];
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
  const candidates = await listMarketplaceListings({
    category: state.category,
    city: state.city,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    condition: state.condition,
    yearMin: state.yearMin,
    yearMax: state.yearMax,
    termGroups: buildRetrievalTermGroups(state),
    excludedTerms: [...state.excludedFeatures, ...state.excludedColors],
    limit: internalCandidateLimit,
  });
  const ranked = rankMarketplaceListings(candidates, state);

  return {
    searchState: state,
    candidateCount: candidates.length,
    ranked,
    shown: ranked.slice(0, finalResultLimit),
    relaxedSuggestion: ranked.length === 0 ? getRelaxedSuggestion(state) : undefined,
  };
}
