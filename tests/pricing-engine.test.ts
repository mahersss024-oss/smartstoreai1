import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendListingPrice } from '@/agent/marketplace/pricing-engine';
import type { ListingRecord } from '@/agent/marketplace/store';

function carListing(input: {
  id: string;
  price: number;
  year: number;
  mileage: number;
}): ListingRecord {
  const now = new Date().toISOString();

  return {
    id: input.id,
    sellerId: `seller:${input.id}`,
    category: 'cars',
    title: `تويوتا كامري ${input.year} هايبرد`,
    description: `كامري ${input.year} هايبرد ممشاها ${input.mileage} كم`,
    price: input.price,
    city: 'تبوك',
    condition: 'used',
    images: [],
    attributes: {
      brand: 'Toyota',
      model: 'Camry',
      year: input.year,
      mileage: input.mileage,
    },
    status: 'published',
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

test('pricing engine recommends a range from real comparable listings', () => {
  const recommendation = recommendListingPrice(
    {
      category: 'cars',
      title: 'تويوتا كامري 2025 هايبرد',
      city: 'تبوك',
      condition: 'used',
      attributes: {
        brand: 'Toyota',
        model: 'Camry',
        year: 2025,
        mileage: 20000,
      },
    },
    [
      carListing({ id: 'price:one', price: 76000, year: 2025, mileage: 25000 }),
      carListing({ id: 'price:two', price: 78000, year: 2024, mileage: 35000 }),
      carListing({ id: 'price:three', price: 81000, year: 2025, mileage: 30000 }),
      carListing({ id: 'price:four', price: 79000, year: 2024, mileage: 40000 }),
      carListing({ id: 'price:five', price: 83000, year: 2025, mileage: 21000 }),
    ],
  );

  assert.equal(recommendation.status, 'priced');
  assert.equal(recommendation.comparableListingCount, 5);
  assert.equal(recommendation.confidence, 'medium');
  assert.equal(typeof recommendation.recommendedRange.min, 'number');
  assert.equal(typeof recommendation.recommendedRange.max, 'number');
});

test('pricing engine refuses to invent a price without enough comparables', () => {
  const recommendation = recommendListingPrice(
    {
      category: 'cars',
      title: 'سيارة نادرة',
      city: 'تبوك',
    },
    [carListing({ id: 'price:only-one', price: 90000, year: 2020, mileage: 100000 })],
  );

  assert.equal(recommendation.status, 'insufficient_market_data');
  assert.equal(recommendation.recommendedRange.min, null);
  assert.equal(recommendation.confidence, 'low');
});
