import assert from 'node:assert/strict';
import test from 'node:test';

import { compareMarketplaceListings } from '@/agent/marketplace/comparison-engine';
import {
  analyzeListingMarket,
  getComparableListings,
} from '@/agent/marketplace/market-intelligence';
import { buildMarketplaceRecommendations } from '@/agent/marketplace/recommendation-engine';
import { rankMarketplaceListings } from '@/agent/marketplace/ranking-engine';
import type { MarketplaceSearchState } from '@/agent/marketplace/search-state';
import type { ListingRecord } from '@/agent/marketplace/store';

function listing(input: {
  id: string;
  price: number;
  year: number;
  mileage: number;
  city?: string;
  condition?: ListingRecord['condition'];
  favoriteCount?: number;
  messageCount?: number;
  views?: number;
}): ListingRecord {
  return {
    id: input.id,
    sellerId: `seller:${input.id}`,
    category: 'cars',
    title: `تويوتا كامري ${input.year} هايبرد`,
    description: `كامري ${input.year} هايبرد ممشاها ${input.mileage} كم`,
    price: input.price,
    city: input.city ?? 'تبوك',
    condition: input.condition ?? 'used',
    images: [
      {
        id: `image:${input.id}`,
        listingId: input.id,
        originalUrl: 'https://example.com/image.jpg',
        displayUrl: 'https://example.com/image.jpg',
        thumbnailUrl: 'https://example.com/image.jpg',
        isPrimary: true,
        qualityScore: 85,
        status: 'approved',
        enhancements: [],
      },
    ],
    attributes: {
      brand: 'Toyota',
      model: 'Camry',
      year: input.year,
      mileage: input.mileage,
      fuel: 'هايبرد',
    },
    status: 'published',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    views: input.views ?? 20,
    messageCount: input.messageCount ?? 1,
    favoriteCount: input.favoriteCount ?? 1,
    compliance: {
      decision: 'allow',
      reasons: [],
      jurisdiction: 'SA',
      shariaSensitive: false,
    },
  };
}

const searchState: MarketplaceSearchState = {
  intent: 'search_listing',
  category: 'cars',
  brand: 'Toyota',
  model: 'Camry',
  city: 'تبوك',
  maxPrice: 80000,
  yearMin: 2022,
  requiredFeatures: ['hybrid'],
  excludedFeatures: [],
  excludedColors: [],
  rankingPreferences: ['price', 'condition'],
  sortPreference: 'best_match',
  terms: ['كامري'],
  revision: 1,
  updatedAt: new Date().toISOString(),
};

test('market intelligence uses real comparable prices only', () => {
  const target = listing({
    id: 'market:target',
    price: 76000,
    year: 2024,
    mileage: 30000,
  });
  const comparables = [
    listing({ id: 'market:one', price: 78000, year: 2024, mileage: 35000 }),
    listing({ id: 'market:two', price: 82000, year: 2023, mileage: 45000 }),
    listing({ id: 'market:three', price: 74000, year: 2024, mileage: 39000 }),
  ];
  const intelligence = analyzeListingMarket(target, comparables);

  assert.equal(intelligence.similarListingCount, 3);
  assert.equal(intelligence.medianMarketPrice, 78000);
  assert.equal(intelligence.priceFairnessScore !== null, true);
  assert.equal(intelligence.insights.some((text) => text.includes('3 إعلان')), true);
});

test('recommendation engine produces limited decision labels', () => {
  const ranked = rankMarketplaceListings(
    [
      listing({ id: 'rec:best', price: 78000, year: 2025, mileage: 18000 }),
      listing({ id: 'rec:cheap', price: 69000, year: 2023, mileage: 65000 }),
      listing({
        id: 'rec:condition',
        price: 80000,
        year: 2024,
        mileage: 22000,
        condition: 'like_new',
      }),
    ],
    searchState,
  );
  const market = new Map(
    ranked.map((item) => [
      item.listing.id,
      analyzeListingMarket(
        item.listing,
        ranked
          .filter((other) => other.listing.id !== item.listing.id)
          .map((other) => other.listing),
      ),
    ]),
  );
  const recommendations = buildMarketplaceRecommendations(ranked, market);

  assert.equal(recommendations.length <= 4, true);
  assert.equal(
    recommendations.some((recommendation) => recommendation.label === 'best_overall'),
    true,
  );
  assert.equal(
    recommendations.some((recommendation) => recommendation.label === 'cheapest'),
    true,
  );
});

test('comparison engine labels target and best alternatives with computed scores', () => {
  const target = listing({
    id: 'compare:target',
    price: 78000,
    year: 2024,
    mileage: 32000,
  });
  const candidates = [
    target,
    listing({ id: 'compare:cheap', price: 71000, year: 2023, mileage: 65000 }),
    listing({
      id: 'compare:clean',
      price: 79000,
      year: 2025,
      mileage: 15000,
      condition: 'like_new',
    }),
  ];
  const comparison = compareMarketplaceListings(target, candidates, 4);

  assert.equal(comparison.target.labels.includes('target'), true);
  assert.equal(comparison.alternatives.length, 2);
  assert.equal(
    [...comparison.alternatives, comparison.target].some((item) =>
      item.labels.includes('best_value'),
    ),
    true,
  );
  assert.equal(comparison.marketSummary.similarListingCount, 2);
});

test('comparable listing filter excludes unrelated cities and categories', () => {
  const target = listing({
    id: 'compare-filter:target',
    price: 78000,
    year: 2024,
    mileage: 32000,
  });
  const unrelatedCity = listing({
    id: 'compare-filter:city',
    price: 77000,
    year: 2024,
    mileage: 31000,
    city: 'الرياض',
  });
  const unrelatedCategory = {
    ...listing({
      id: 'compare-filter:category',
      price: 1200,
      year: 2024,
      mileage: 0,
    }),
    category: 'mobile_phones',
  };

  const comparable = getComparableListings(target, [
    unrelatedCity,
    unrelatedCategory,
  ]);

  assert.equal(comparable.length, 0);
});
