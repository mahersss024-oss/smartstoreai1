import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateNegotiationOffer } from '@/agent/marketplace/negotiation-engine';
import type { ListingRecord } from '@/agent/marketplace/store';

function listing(input: {
  id: string;
  price: number;
  year?: number;
  mileage?: number;
}): ListingRecord {
  const now = new Date().toISOString();
  const year = input.year ?? 2024;
  const mileage = input.mileage ?? 30000;

  return {
    id: input.id,
    sellerId: `seller:${input.id}`,
    category: 'cars',
    title: `تويوتا كامري ${year} هايبرد`,
    description: `كامري ${year} هايبرد ممشاها ${mileage} كم`,
    price: input.price,
    city: 'تبوك',
    condition: 'used',
    images: [],
    attributes: {
      brand: 'Toyota',
      model: 'Camry',
      year,
      mileage,
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

test('negotiation engine classifies low offers without committing to a deal', () => {
  const advice = evaluateNegotiationOffer(
    listing({ id: 'negotiation:target', price: 80000 }),
    65000,
    [
      listing({ id: 'negotiation:one', price: 78000 }),
      listing({ id: 'negotiation:two', price: 82000 }),
      listing({ id: 'negotiation:three', price: 79000 }),
    ],
  );

  assert.equal(advice.stance, 'too_low');
  assert.equal(advice.requiresExplicitConfirmation, true);
  assert.equal(typeof advice.suggestedCounterRange.min, 'number');
  assert.equal(advice.reasons.length > 0, true);
});

test('negotiation engine recognizes strong offers when no market data exists', () => {
  const advice = evaluateNegotiationOffer(
    listing({ id: 'negotiation:strong', price: 30000 }),
    31500,
    [],
  );

  assert.equal(advice.stance, 'reasonable');
  assert.equal(advice.offerPercentOfAsking, 105);
});
