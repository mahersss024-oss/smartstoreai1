import { listMarketplaceListings } from './repository';
import {
  rankMarketplaceListings,
  type RankedMarketplaceListing,
} from './ranking-engine';
import { getMarketplaceSearchTermVariants } from './search';
import type { MarketplaceSearchState } from './search-state';
import { listingSemanticText, marketplaceTextAnalyzer, prepareListingUnderstanding } from './text-understanding';

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
  return [
    ...(state.brand ? [getMarketplaceSearchTermVariants(state.brand, state.rawQuery, state.termAliases)] : []),
    ...(state.model ? [getMarketplaceSearchTermVariants(state.model, state.rawQuery, state.termAliases)] : []),
    ...(state.color ? [getMarketplaceSearchTermVariants(state.color, state.rawQuery, state.termAliases)] : []),
    ...state.requiredFeatures.map(
      (feature) => getMarketplaceSearchTermVariants(feature, state.rawQuery, state.termAliases),
    ),
    ...state.terms.map((term) => getMarketplaceSearchTermVariants(term, state.rawQuery, state.termAliases)),
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
    query: state.rawQuery,
    category: state.category,
    city: state.city,
    cityVariants: state.city ? getMarketplaceSearchTermVariants(state.city, state.rawQuery, state.termAliases) : undefined,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    condition: state.condition,
    yearMin: state.yearMin,
    yearMax: state.yearMax,
    termGroups: buildRetrievalTermGroups(state),
    excludedTerms: [...state.excludedFeatures, ...state.excludedColors],
    limit: internalCandidateLimit,
  });
  const queryAnalysis = marketplaceTextAnalyzer.peek(state.rawQuery ?? '');
  if (queryAnalysis?.product && queryAnalysis.confidence >= 0.8) await prepareListingUnderstanding(candidates);
  const relevantCandidates = candidates.filter(listing => {
    if (!queryAnalysis?.product || queryAnalysis.confidence < 0.8) return true;
    const analysis = marketplaceTextAnalyzer.peek(listingSemanticText(listing));
    if (!analysis?.product || analysis.confidence < 0.8) return true;
    return analysis.product === queryAnalysis.product && (queryAnalysis.offerKind === 'unknown'
      || analysis.offerKind === 'unknown' || analysis.offerKind === queryAnalysis.offerKind);
  });
  const ranked = rankMarketplaceListings(relevantCandidates, state);

  return {
    searchState: state,
    candidateCount: candidates.length,
    ranked,
    shown: ranked.slice(0, finalResultLimit),
    relaxedSuggestion: ranked.length === 0 ? getRelaxedSuggestion(state) : undefined,
  };
}
