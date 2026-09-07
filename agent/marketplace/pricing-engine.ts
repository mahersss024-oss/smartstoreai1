import {
  analyzeListingMarket,
  getComparableListings,
} from './market-intelligence';
import {
  extractListingMileage,
  extractListingYear,
} from './ranking-engine';
import type { CreateListingInput } from './repository';
import type { ListingRecord } from './store';

export type PricingRecommendation = {
  status: 'priced' | 'insufficient_market_data';
  comparableListingCount: number;
  medianPrice: number | null;
  averagePrice: number | null;
  recommendedRange: {
    min: number | null;
    max: number | null;
  };
  confidence: 'low' | 'medium' | 'high';
  adjustments: Array<{
    reason: string;
    percent: number;
  }>;
  explanation: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function numericPrices(listings: ListingRecord[]) {
  return listings
    .map((listing) => (typeof listing.price === 'number' ? listing.price : null))
    .filter((price): price is number => typeof price === 'number');
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle] ?? null
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function toDraftListing(input: CreateListingInput): ListingRecord {
  const now = new Date().toISOString();

  return {
    id: 'pricing:draft',
    sellerId: 'pricing:seller',
    category: input.category,
    title: input.title,
    description: input.description,
    price: typeof input.price === 'number' ? input.price : undefined,
    city: input.city,
    condition: input.condition,
    images: [],
    attributes: input.attributes ?? {},
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    views: 0,
    messageCount: 0,
    favoriteCount: 0,
    compliance: {
      decision: 'allow',
      reasons: [],
      jurisdiction: 'SA',
      shariaSensitive: false,
    },
  };
}

function conditionAdjustment(condition: ListingRecord['condition']) {
  if (condition === 'new') {
    return 0.08;
  }

  if (condition === 'like_new') {
    return 0.04;
  }

  if (condition === 'damaged') {
    return -0.15;
  }

  return 0;
}

function mileageAdjustment(target: ListingRecord, comparables: ListingRecord[]) {
  const targetMileage = extractListingMileage(target);
  const comparableMileages = comparables
    .map(extractListingMileage)
    .filter((mileage): mileage is number => typeof mileage === 'number');

  if (!targetMileage || comparableMileages.length === 0) {
    return 0;
  }

  const averageMileage =
    comparableMileages.reduce((sum, value) => sum + value, 0) /
    comparableMileages.length;
  const difference = (averageMileage - targetMileage) / Math.max(averageMileage, 1);

  return clamp(difference * 0.12, -0.08, 0.08);
}

function yearAdjustment(target: ListingRecord, comparables: ListingRecord[]) {
  const targetYear = extractListingYear(target);
  const comparableYears = comparables
    .map(extractListingYear)
    .filter((year): year is number => typeof year === 'number');

  if (!targetYear || comparableYears.length === 0) {
    return 0;
  }

  const averageYear =
    comparableYears.reduce((sum, value) => sum + value, 0) / comparableYears.length;

  return clamp((targetYear - averageYear) * 0.025, -0.08, 0.08);
}

function getConfidence(count: number) {
  if (count >= 12) {
    return 'high';
  }

  if (count >= 5) {
    return 'medium';
  }

  return 'low';
}

export function recommendListingPrice(
  input: CreateListingInput,
  marketplaceListings: ListingRecord[],
): PricingRecommendation {
  const target = toDraftListing(input);
  const comparables = getComparableListings(target, marketplaceListings).slice(0, 30);
  const prices = numericPrices(comparables);
  const medianPrice = median(prices);
  const averagePrice = average(prices);

  if (!medianPrice || prices.length < 2) {
    return {
      status: 'insufficient_market_data',
      comparableListingCount: comparables.length,
      medianPrice,
      averagePrice,
      recommendedRange: { min: null, max: null },
      confidence: 'low',
      adjustments: [],
      explanation:
        'لا توجد بيانات سوق كافية لحساب نطاق سعر موثوق. استخدم السعر كبداية واجمع مقارنات أكثر.',
    };
  }

  const adjustments = [
    {
      reason: 'تعديل الحالة',
      percent: conditionAdjustment(target.condition),
    },
    {
      reason: 'تعديل الممشى',
      percent: mileageAdjustment(target, comparables),
    },
    {
      reason: 'تعديل سنة الموديل',
      percent: yearAdjustment(target, comparables),
    },
  ].filter((adjustment) => adjustment.percent !== 0);
  const totalAdjustment = clamp(
    adjustments.reduce((sum, adjustment) => sum + adjustment.percent, 0),
    -0.2,
    0.2,
  );
  const adjustedMedian = medianPrice * (1 + totalAdjustment);
  const confidence = getConfidence(prices.length);
  const spread = confidence === 'high' ? 0.04 : confidence === 'medium' ? 0.07 : 0.1;
  const market = analyzeListingMarket(target, comparables);

  return {
    status: 'priced',
    comparableListingCount: comparables.length,
    medianPrice,
    averagePrice,
    recommendedRange: {
      min: Math.round(adjustedMedian * (1 - spread)),
      max: Math.round(adjustedMedian * (1 + spread)),
    },
    confidence,
    adjustments: adjustments.map((adjustment) => ({
      reason: adjustment.reason,
      percent: Math.round(adjustment.percent * 100),
    })),
    explanation: `النطاق مبني على ${comparables.length} إعلان مشابه فعلي وثقة ${market.confidence}.`,
  };
}
