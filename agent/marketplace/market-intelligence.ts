import {
  extractListingMileage,
  extractListingYear,
  scoreListingQuality,
} from './ranking-engine';
import { normalizeMarketplaceSearchText } from './search';
import type { ListingRecord } from './store';
import { getListingSimilarityScore } from './listing-similarity';

export type ListingMarketIntelligence = {
  listingId: string;
  averageMarketPrice: number | null;
  medianMarketPrice: number | null;
  pricePercentile: number | null;
  similarListingCount: number;
  daysOnMarket: number;
  demandScore: number;
  supplyScore: number;
  priceFairnessScore: number | null;
  listingQualityScore: number;
  sellerTrustScore: number;
  engagementScore: number;
  marketValueScore: number | null;
  confidence: 'low' | 'medium' | 'high';
  insights: string[];
};

function numericPrice(listing: ListingRecord) {
  return typeof listing.price === 'number' ? listing.price : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function percentile(values: number[], value: number) {
  if (values.length === 0) {
    return null;
  }

  const lessOrEqual = values.filter((candidate) => candidate <= value).length;
  return Math.round((lessOrEqual / values.length) * 100);
}

function daysOnMarket(listing: ListingRecord) {
  const ageMs = Date.now() - new Date(listing.createdAt).getTime();
  return Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
}

function engagementScore(listing: ListingRecord) {
  return clampScore(
    30 +
      Math.min(100, listing.views) * 0.35 +
      Math.min(20, listing.favoriteCount) * 1.4 +
      Math.min(20, listing.messageCount) * 1.2,
  );
}

function demandScore(listing: ListingRecord) {
  const ageDays = Math.max(1, daysOnMarket(listing));
  const dailyInterest =
    (listing.views + listing.favoriteCount * 4 + listing.messageCount * 5) / ageDays;

  return clampScore(35 + dailyInterest * 8);
}

function supplyScore(similarListingCount: number) {
  if (similarListingCount <= 1) {
    return 25;
  }

  if (similarListingCount <= 5) {
    return 50;
  }

  if (similarListingCount <= 20) {
    return 75;
  }

  return 92;
}

function priceFairnessScore(price: number | null, marketMedian: number | null) {
  if (!price || !marketMedian) {
    return null;
  }

  const differenceRatio = (price - marketMedian) / marketMedian;

  if (differenceRatio <= -0.08) {
    return 96;
  }

  if (differenceRatio <= 0.03) {
    return 88;
  }

  if (differenceRatio <= 0.1) {
    return 68;
  }

  if (differenceRatio <= 0.2) {
    return 44;
  }

  return 25;
}

function sellerTrustScore(listing: ListingRecord) {
  return clampScore(
    55 +
      Math.min(10, listing.favoriteCount) * 2 +
      Math.min(10, listing.messageCount) * 1.5 +
      (listing.images.some((image) => image.status === 'approved') ? 12 : 0),
  );
}

function confidence(similarListingCount: number) {
  if (similarListingCount >= 12) {
    return 'high';
  }

  if (similarListingCount >= 5) {
    return 'medium';
  }

  return 'low';
}

function productSimilarityScore(target: ListingRecord, candidate: ListingRecord) {
  return getListingSimilarityScore(target, candidate);
}

function buildInsights(input: {
  price: number | null;
  medianMarketPrice: number | null;
  similarListingCount: number;
  fairnessScore: number | null;
  demand: number;
  quality: number;
}) {
  const insights: string[] = [];

  if (input.medianMarketPrice && input.price) {
    const difference = Math.round(
      ((input.price - input.medianMarketPrice) / input.medianMarketPrice) * 100,
    );

    if (difference < 0) {
      insights.push(`السعر أقل من وسيط الإعلانات المشابهة بنحو ${Math.abs(difference)}%`);
    } else if (difference > 0) {
      insights.push(`السعر أعلى من وسيط الإعلانات المشابهة بنحو ${difference}%`);
    } else {
      insights.push('السعر قريب جدًا من وسيط الإعلانات المشابهة');
    }
  }

  if (input.similarListingCount > 0) {
    insights.push(`تمت المقارنة مع ${input.similarListingCount} إعلان مشابه فعلي`);
  }

  if (input.demand >= 75) {
    insights.push('مؤشرات الاهتمام بهذا الإعلان قوية');
  }

  if (input.quality >= 75) {
    insights.push('جودة بيانات الإعلان جيدة');
  }

  if (input.fairnessScore === null) {
    insights.push('لا توجد أسعار كافية لحساب عدالة السعر بثقة');
  }

  return insights.slice(0, 4);
}

export function getComparableListings(
  target: ListingRecord,
  candidates: ListingRecord[],
) {
  const targetYear = extractListingYear(target);
  const targetMileage = extractListingMileage(target);

  return candidates
    .map((candidate) => ({
      listing: candidate,
      productScore: productSimilarityScore(target, candidate),
    }))
    .filter(({ listing: candidate, productScore }) => {
      if (candidate.id === target.id) {
        return false;
      }

      if (candidate.category !== target.category) {
        return false;
      }

      if (productScore <= 0) {
        return false;
      }

      if (
        target.city &&
        candidate.city &&
        normalizeMarketplaceSearchText(candidate.city) !==
          normalizeMarketplaceSearchText(target.city)
      ) {
        return false;
      }

      const candidateYear = extractListingYear(candidate);

      if (
        targetYear &&
        candidateYear &&
        Math.abs(candidateYear - targetYear) > 3
      ) {
        return false;
      }

      const candidateMileage = extractListingMileage(candidate);

      if (
        targetMileage &&
        candidateMileage &&
        Math.abs(candidateMileage - targetMileage) > 80_000
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => right.productScore - left.productScore)
    .map(({ listing }) => listing);
}

export function analyzeListingMarket(
  listing: ListingRecord,
  comparableListings: ListingRecord[],
): ListingMarketIntelligence {
  const prices = comparableListings
    .map(numericPrice)
    .filter((price): price is number => typeof price === 'number');
  const price = numericPrice(listing);
  const averageMarketPrice = average(prices);
  const medianMarketPrice = median(prices);
  const fairnessScore = priceFairnessScore(price, medianMarketPrice);
  const demand = demandScore(listing);
  const quality = scoreListingQuality(listing);
  const trust = sellerTrustScore(listing);
  const marketValueScore =
    fairnessScore === null
      ? null
      : clampScore(fairnessScore * 0.55 + quality * 0.25 + trust * 0.2);

  return {
    listingId: listing.id,
    averageMarketPrice,
    medianMarketPrice,
    pricePercentile: price ? percentile(prices, price) : null,
    similarListingCount: comparableListings.length,
    daysOnMarket: daysOnMarket(listing),
    demandScore: demand,
    supplyScore: supplyScore(comparableListings.length),
    priceFairnessScore: fairnessScore,
    listingQualityScore: quality,
    sellerTrustScore: trust,
    engagementScore: engagementScore(listing),
    marketValueScore,
    confidence: confidence(comparableListings.length),
    insights: buildInsights({
      price,
      medianMarketPrice,
      similarListingCount: comparableListings.length,
      fairnessScore,
      demand,
      quality,
    }),
  };
}

export function analyzeMarketForRankedListings(listings: ListingRecord[]) {
  const market = new Map<string, ListingMarketIntelligence>();

  for (const listing of listings) {
    market.set(
      listing.id,
      analyzeListingMarket(listing, getComparableListings(listing, listings)),
    );
  }

  return market;
}
