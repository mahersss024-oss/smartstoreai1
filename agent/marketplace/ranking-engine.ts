import {
  getMarketplaceCitySearchVariants,
  normalizeMarketplaceSearchText,
  parseMarketplaceSearchQuery,
} from './search';
import type { MarketplaceSearchState } from './search-state';
import type { ListingRecord } from './store';

export type RankedMarketplaceListing = {
  listing: ListingRecord;
  scores: {
    relevanceScore: number;
    priceScore: number;
    locationScore: number;
    conditionScore: number;
    mileageScore: number;
    specificationsScore: number;
    listingQualityScore: number;
    freshnessScore: number;
    engagementScore: number;
    finalScore: number;
  };
  reasons: string[];
};

type RankingWeights = {
  relevance: number;
  price: number;
  location: number;
  condition: number;
  mileage: number;
  specifications: number;
  listingQuality: number;
  freshness: number;
  engagement: number;
};

const baseWeights: RankingWeights = {
  relevance: 0.3,
  price: 0.2,
  location: 0.1,
  condition: 0.1,
  mileage: 0.08,
  specifications: 0.07,
  listingQuality: 0.07,
  freshness: 0.05,
  engagement: 0.03,
};
const featureScoreTerms = new Map([
  ['hybrid', ['hybrid', 'هايبرد', 'هجين']],
  ['clean', ['clean', 'نظيف', 'نظيفة', 'ممتاز', 'ممتازة']],
  ['no_accident_history', ['بدون حوادث', 'لا يوجد حوادث']],
]);

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWeights(weights: RankingWeights): RankingWeights {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);

  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / total]),
  ) as RankingWeights;
}

export function buildRankingWeights(state: MarketplaceSearchState) {
  const weights = { ...baseWeights };

  for (const preference of state.rankingPreferences) {
    if (preference === 'price') {
      weights.price += 0.16;
    }

    if (preference === 'location') {
      weights.location += 0.14;
    }

    if (preference === 'condition') {
      weights.condition += 0.12;
    }

    if (preference === 'mileage') {
      weights.mileage += 0.16;
    }

    if (preference === 'year') {
      weights.specifications += 0.08;
      weights.freshness += 0.05;
    }

    if (preference === 'listing_quality') {
      weights.listingQuality += 0.12;
    }

    if (preference === 'freshness') {
      weights.freshness += 0.12;
    }

    if (preference === 'engagement') {
      weights.engagement += 0.1;
    }
  }

  if (state.sortPreference === 'cheapest') {
    weights.price += 0.22;
  }

  if (state.sortPreference === 'closest') {
    weights.location += 0.18;
  }

  if (state.sortPreference === 'best_condition') {
    weights.condition += 0.16;
    weights.listingQuality += 0.1;
  }

  if (state.sortPreference === 'lowest_mileage') {
    weights.mileage += 0.22;
  }

  if (state.sortPreference === 'newest') {
    weights.specifications += 0.1;
    weights.freshness += 0.12;
  }

  return normalizeWeights(weights);
}

function listingText(listing: ListingRecord) {
  return normalizeMarketplaceSearchText(
    [
      listing.category,
      listing.title,
      listing.description,
      listing.city,
      listing.condition,
      Object.values(listing.attributes).join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function textIncludesAny(text: string, values: string[]) {
  return values.some((value) =>
    text.includes(normalizeMarketplaceSearchText(value)),
  );
}

function getNumericAttribute(
  listing: ListingRecord,
  keys: string[],
): number | null {
  const normalizedKeys = keys.map(normalizeMarketplaceSearchText);

  for (const [key, value] of Object.entries(listing.attributes)) {
    if (!normalizedKeys.includes(normalizeMarketplaceSearchText(key))) {
      continue;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.]/g, ''));

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

export function extractListingYear(listing: ListingRecord) {
  const attributeYear = getNumericAttribute(listing, [
    'year',
    'modelYear',
    'سنة',
    'موديل',
  ]);

  if (attributeYear) {
    return Math.round(attributeYear);
  }

  const match = listingText(listing).match(/(?:19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

export function extractListingMileage(listing: ListingRecord) {
  const attributeMileage = getNumericAttribute(listing, [
    'mileage',
    'odometer',
    'ممشى',
    'ممشاها',
    'ماشيه',
  ]);

  if (attributeMileage) {
    return Math.round(attributeMileage);
  }

  const match = listingText(listing).match(
    /(?:ممشي|ممشى|ممشاها|ماشيه|ماشية).{0,18}(\d{1,7})\s*(الف|k)?/i,
  );

  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? '', 10);
  const unit = normalizeMarketplaceSearchText(match[2] ?? '');

  return Number.isFinite(value) ? (unit === 'الف' || unit === 'k' ? value * 1000 : value) : null;
}

function scoreRelevance(listing: ListingRecord, state: MarketplaceSearchState) {
  const text = listingText(listing);
  const desiredTerms = [
    state.category,
    state.brand,
    state.model,
    ...state.terms,
    ...state.requiredFeatures.flatMap(
      (feature) => featureScoreTerms.get(feature) ?? [feature],
    ),
  ].filter((value): value is string => Boolean(value));

  if (desiredTerms.length === 0) {
    return 72;
  }

  const matched = desiredTerms.filter((term) => {
    const variants = parseMarketplaceSearchQuery(term).termGroups[0] ?? [term];
    return textIncludesAny(text, variants);
  }).length;

  return clampScore((matched / desiredTerms.length) * 100);
}

function scorePrice(listing: ListingRecord, state: MarketplaceSearchState) {
  if (typeof listing.price !== 'number') {
    return 45;
  }

  if (state.minPrice !== undefined && listing.price < state.minPrice) {
    return 0;
  }

  if (state.maxPrice !== undefined && listing.price > state.maxPrice) {
    return 0;
  }

  if (state.maxPrice !== undefined) {
    const budgetUse = listing.price / state.maxPrice;
    return clampScore(100 - Math.max(0, budgetUse - 0.75) * 120);
  }

  return 75;
}

function scoreLocation(listing: ListingRecord, state: MarketplaceSearchState) {
  if (!state.city) {
    return 70;
  }

  const normalizedListingCity = normalizeMarketplaceSearchText(listing.city ?? '');
  const matchesCity = getMarketplaceCitySearchVariants(state.city).some(
    (cityVariant) =>
      normalizedListingCity.includes(
        normalizeMarketplaceSearchText(cityVariant),
      ),
  );

  return matchesCity
    ? 100
    : 15;
}

function scoreCondition(listing: ListingRecord, state: MarketplaceSearchState) {
  if (state.condition && listing.condition === state.condition) {
    return 100;
  }

  if (listing.condition === 'new') {
    return 92;
  }

  if (listing.condition === 'like_new') {
    return 88;
  }

  if (listing.condition === 'used') {
    return 70;
  }

  if (listing.condition === 'damaged') {
    return 25;
  }

  return 55;
}

function scoreMileage(listing: ListingRecord, state: MarketplaceSearchState) {
  const mileage = extractListingMileage(listing);

  if (!mileage) {
    return state.rankingPreferences.includes('mileage') ? 45 : 65;
  }

  if (state.mileageMax !== undefined && mileage > state.mileageMax) {
    return 0;
  }

  if (mileage <= 30_000) {
    return 100;
  }

  if (mileage <= 60_000) {
    return 88;
  }

  if (mileage <= 100_000) {
    return 72;
  }

  if (mileage <= 160_000) {
    return 50;
  }

  return 28;
}

function scoreSpecifications(listing: ListingRecord, state: MarketplaceSearchState) {
  const year = extractListingYear(listing);
  let score = 68;

  if (year) {
    if (state.yearMin !== undefined && year < state.yearMin) {
      return 0;
    }

    if (state.yearMax !== undefined && year > state.yearMax) {
      return 0;
    }

    score = state.yearMin !== undefined ? 86 + Math.min(14, year - state.yearMin) : 78;
  }

  if (state.requiredFeatures.length) {
    const text = listingText(listing);
    const matched = state.requiredFeatures.filter((feature) =>
      textIncludesAny(text, featureScoreTerms.get(feature) ?? [feature]),
    ).length;

    score = Math.min(score, clampScore((matched / state.requiredFeatures.length) * 100));
  }

  return clampScore(score);
}

export function scoreListingQuality(listing: ListingRecord) {
  let score = 20;

  if (listing.title && listing.title.length >= 8) {
    score += 20;
  }

  if (listing.description && listing.description.length >= 30) {
    score += 22;
  }

  if (listing.images.some((image) => image.status === 'approved')) {
    score += 28;
  }

  if (Object.keys(listing.attributes).length >= 2) {
    score += 10;
  }

  return clampScore(score);
}

function scoreFreshness(listing: ListingRecord) {
  const ageMs = Date.now() - new Date(listing.updatedAt).getTime();
  const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000));

  if (ageDays <= 2) {
    return 100;
  }

  if (ageDays <= 14) {
    return 82;
  }

  if (ageDays <= 45) {
    return 64;
  }

  return 42;
}

function scoreEngagement(listing: ListingRecord) {
  return clampScore(
    Math.min(60, listing.views) * 0.5 +
      Math.min(10, listing.favoriteCount) * 4 +
      Math.min(10, listing.messageCount) * 3 +
      35,
  );
}

function buildReasons(
  listing: ListingRecord,
  state: MarketplaceSearchState,
  scores: RankedMarketplaceListing['scores'],
) {
  const reasons: string[] = [];
  const year = extractListingYear(listing);
  const mileage = extractListingMileage(listing);

  if (scores.priceScore >= 85 && typeof listing.price === 'number') {
    reasons.push('داخل الميزانية المطلوبة');
  }

  if (state.city && scores.locationScore === 100) {
    reasons.push(`موجود في ${state.city}`);
  }

  if (year && state.yearMin && year >= state.yearMin) {
    reasons.push('موديله يطابق الحد المطلوب أو أحدث');
  }

  if (mileage && scores.mileageScore >= 80) {
    reasons.push('ممشى الإعلان مناسب مقارنة بطلبك');
  }

  if (scores.conditionScore >= 85) {
    reasons.push('حالته قوية حسب بيانات الإعلان');
  }

  if (scores.listingQualityScore >= 75) {
    reasons.push('بيانات الإعلان وصوره جيدة');
  }

  if (reasons.length === 0) {
    reasons.push('أقرب نتيجة متاحة حسب القيود الحالية');
  }

  return reasons.slice(0, 4);
}

export function rankMarketplaceListings(
  listings: ListingRecord[],
  state: MarketplaceSearchState,
) {
  const weights = buildRankingWeights(state);

  return listings
    .map((listing) => {
      const scores = {
        relevanceScore: scoreRelevance(listing, state),
        priceScore: scorePrice(listing, state),
        locationScore: scoreLocation(listing, state),
        conditionScore: scoreCondition(listing, state),
        mileageScore: scoreMileage(listing, state),
        specificationsScore: scoreSpecifications(listing, state),
        listingQualityScore: scoreListingQuality(listing),
        freshnessScore: scoreFreshness(listing),
        engagementScore: scoreEngagement(listing),
        finalScore: 0,
      };
      const finalScore = clampScore(
        scores.relevanceScore * weights.relevance +
          scores.priceScore * weights.price +
          scores.locationScore * weights.location +
          scores.conditionScore * weights.condition +
          scores.mileageScore * weights.mileage +
          scores.specificationsScore * weights.specifications +
          scores.listingQualityScore * weights.listingQuality +
          scores.freshnessScore * weights.freshness +
          scores.engagementScore * weights.engagement,
      );

      scores.finalScore = finalScore;

      return {
        listing,
        scores,
        reasons: buildReasons(listing, state, scores),
      };
    })
    .filter((result) => result.scores.priceScore > 0)
    .filter((result) => result.scores.specificationsScore > 0)
    .filter((result) => result.scores.mileageScore > 0)
    .sort((left, right) => {
      if (state.sortPreference === 'cheapest') {
        const leftPrice =
          typeof left.listing.price === 'number' ? left.listing.price : Number.MAX_SAFE_INTEGER;
        const rightPrice =
          typeof right.listing.price === 'number' ? right.listing.price : Number.MAX_SAFE_INTEGER;

        if (leftPrice !== rightPrice) {
          return leftPrice - rightPrice;
        }
      }

      if (right.scores.finalScore !== left.scores.finalScore) {
        return right.scores.finalScore - left.scores.finalScore;
      }

      return right.listing.updatedAt.localeCompare(left.listing.updatedAt);
    });
}
