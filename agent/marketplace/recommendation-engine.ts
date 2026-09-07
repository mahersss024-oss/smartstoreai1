import type { ListingMarketIntelligence } from './market-intelligence';
import type { RankedMarketplaceListing } from './ranking-engine';

export type MarketplaceRecommendation = {
  label:
    | 'best_overall'
    | 'cheapest'
    | 'best_condition'
    | 'best_value';
  listingId: string;
  score: number;
  reason: string;
};

function numericPrice(result: RankedMarketplaceListing) {
  return typeof result.listing.price === 'number' ? result.listing.price : null;
}

function chooseHighest<T>(
  values: T[],
  score: (value: T) => number | null | undefined,
) {
  return values
    .map((value) => ({ value, score: score(value) }))
    .filter(
      (entry): entry is { value: T; score: number } =>
        typeof entry.score === 'number' && Number.isFinite(entry.score),
    )
    .sort((left, right) => right.score - left.score)[0];
}

function chooseLowest<T>(
  values: T[],
  score: (value: T) => number | null | undefined,
) {
  return values
    .map((value) => ({ value, score: score(value) }))
    .filter(
      (entry): entry is { value: T; score: number } =>
        typeof entry.score === 'number' && Number.isFinite(entry.score),
    )
    .sort((left, right) => left.score - right.score)[0];
}

function addUniqueRecommendation(
  recommendations: MarketplaceRecommendation[],
  recommendation: MarketplaceRecommendation | null,
) {
  if (!recommendation) {
    return;
  }

  const existing = recommendations.find(
    (current) => current.label === recommendation.label,
  );

  if (!existing) {
    recommendations.push(recommendation);
  }
}

export function buildMarketplaceRecommendations(
  rankedListings: RankedMarketplaceListing[],
  market: Map<string, ListingMarketIntelligence>,
) {
  const recommendations: MarketplaceRecommendation[] = [];

  const bestOverall = chooseHighest(
    rankedListings,
    (result) => result.scores.finalScore,
  );
  addUniqueRecommendation(
    recommendations,
    bestOverall
      ? {
          label: 'best_overall',
          listingId: bestOverall.value.listing.id,
          score: bestOverall.score,
          reason:
            bestOverall.value.reasons[0] ??
            'أفضل تطابق إجمالي حسب القيود الحالية',
        }
      : null,
  );

  const cheapest = chooseLowest(rankedListings, numericPrice);
  addUniqueRecommendation(
    recommendations,
    cheapest
      ? {
          label: 'cheapest',
          listingId: cheapest.value.listing.id,
          score: cheapest.score,
          reason: 'أقل سعر بين النتائج المطابقة للقيود الحالية',
        }
      : null,
  );

  const bestCondition = chooseHighest(
    rankedListings,
    (result) =>
      result.scores.conditionScore * 0.65 +
      result.scores.listingQualityScore * 0.35,
  );
  addUniqueRecommendation(
    recommendations,
    bestCondition
      ? {
          label: 'best_condition',
          listingId: bestCondition.value.listing.id,
          score: Math.round(bestCondition.score),
          reason: 'أقوى خيار من ناحية الحالة وجودة بيانات الإعلان',
        }
      : null,
  );

  const bestValue = chooseHighest(rankedListings, (result) => {
    const intelligence = market.get(result.listing.id);

    return intelligence?.marketValueScore ?? result.scores.priceScore;
  });
  addUniqueRecommendation(
    recommendations,
    bestValue
      ? {
          label: 'best_value',
          listingId: bestValue.value.listing.id,
          score: Math.round(bestValue.score),
          reason: 'أفضل قيمة محسوبة من السعر وجودة الإعلان والثقة',
        }
      : null,
  );

  return recommendations.slice(0, 4);
}
