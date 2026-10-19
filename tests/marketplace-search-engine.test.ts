import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { mockSearchModel } from './helpers/search-model-fixtures';

import {
  rankMarketplaceListings,
  buildRankingWeights,
} from '@/agent/marketplace/ranking-engine';
import { parseStructuredSearchIntent } from '@/agent/marketplace/structured-search-intent';
import {
  createListingDraft,
  publishListing,
  resetMarketplaceStoreForTests,
  type ListingRecord,
} from '@/agent/marketplace/store';

beforeEach(context => {
  mockSearchModel(context);
  resetMarketplaceStoreForTests();
});

function publishTestListing(input: {
  id: string;
  title: string;
  price: number;
  year: number;
  mileage: number;
  city?: string;
  color?: string;
  brand?: string;
  model?: string;
  description?: string;
}) {
  const listing = createListingDraft({
    id: input.id,
    sellerId: `seller:${input.id}`,
    category: 'cars',
    title: input.title,
    description:
      input.description ?? `تويوتا كامري ${input.year} هايبرد ممشاها ${input.mileage} كم`,
    price: input.price,
    city: input.city ?? 'تبوك',
    condition: 'used',
    attributes: {
      brand: input.brand ?? 'Toyota',
      model: input.model ?? 'Camry',
      year: input.year,
      mileage: input.mileage,
      fuel: 'هايبرد',
      color: input.color ?? 'أبيض',
    },
  });

  publishListing(listing.id);
  return listing;
}

test('parses structured buyer intent with hard filters and preferences', () => {
  const intent = parseStructuredSearchIntent(
    'أريد كامري 2022 أو أحدث في تبوك تحت 80 ألف والأهم ممشى قليل',
  );

  assert.equal(intent.intent, 'search_listing');
  assert.equal(intent.category, 'cars');
  assert.equal(intent.brand, 'Toyota');
  assert.equal(intent.model, 'Camry');
  assert.equal(intent.city, 'تبوك');
  assert.equal(intent.yearMin, 2022);
  assert.equal(intent.maxPrice, 80000);
  assert.equal(intent.rankingPreferences.includes('mileage'), true);
});

test('ranking profile raises mileage weight when buyer prioritizes low mileage', () => {
  const defaultWeights = buildRankingWeights({
    intent: 'search_listing',
    rankingPreferences: [],
    requiredFeatures: [],
    excludedFeatures: [],
    excludedColors: [],
    terms: [],
    revision: 1,
    updatedAt: new Date().toISOString(),
  });
  const mileageWeights = buildRankingWeights({
    intent: 'search_listing',
    rankingPreferences: ['mileage'],
    sortPreference: 'lowest_mileage',
    requiredFeatures: [],
    excludedFeatures: [],
    excludedColors: [],
    terms: [],
    revision: 1,
    updatedAt: new Date().toISOString(),
  });

  assert.equal(mileageWeights.mileage > defaultWeights.mileage, true);
});

test('ranking engine returns explainable scores without LLM scoring', () => {
  const listing = publishTestListing({
    id: 'listing:p0-ranking-explain',
    title: 'تويوتا كامري 2025 هايبرد',
    price: 76000,
    year: 2025,
    mileage: 18000,
  }) as ListingRecord;
  const ranked = rankMarketplaceListings([listing], {
    intent: 'search_listing',
    category: 'cars',
    brand: 'Toyota',
    model: 'Camry',
    city: 'تبوك',
    maxPrice: 80000,
    yearMin: 2022,
    rankingPreferences: ['mileage'],
    requiredFeatures: ['hybrid'],
    excludedFeatures: [],
    excludedColors: [],
    terms: ['كامري'],
    revision: 1,
    updatedAt: new Date().toISOString(),
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].scores.finalScore > 70, true);
  assert.equal(ranked[0].reasons.length > 0, true);
});

test('structured Arabic search ignores connected brand and model words after extracting intent', () => {
  const intent = parseStructuredSearchIntent('ابي ونيسان والبترول');

  assert.equal(intent.brand, 'Nissan');
  assert.equal(intent.model, 'Patrol');
  assert.deepEqual(intent.terms, []);
});
