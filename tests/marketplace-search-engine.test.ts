import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rankMarketplaceListings,
  buildRankingWeights,
} from '@/agent/marketplace/ranking-engine';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import { resetMarketplaceSearchState } from '@/agent/marketplace/search-state';
import { parseStructuredSearchIntent } from '@/agent/marketplace/structured-search-intent';
import {
  createListingDraft,
  publishListing,
  type ListingRecord,
} from '@/agent/marketplace/store';

function publishTestListing(input: {
  id: string;
  title: string;
  price: number;
  year: number;
  mileage: number;
  city?: string;
  color?: string;
}) {
  const listing = createListingDraft({
    id: input.id,
    sellerId: `seller:${input.id}`,
    category: 'cars',
    title: input.title,
    description: `تويوتا كامري ${input.year} هايبرد ممشاها ${input.mileage} كم`,
    price: input.price,
    city: input.city ?? 'تبوك',
    condition: 'used',
    attributes: {
      brand: 'Toyota',
      model: 'Camry',
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

test('keeps one accumulated server search state across buyer followups', async () => {
  const ownerKey = 'test:search-state-camry-tabuk';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-camry-best',
    title: 'تويوتا كامري 2023 هايبرد نص فل',
    price: 78000,
    year: 2023,
    mileage: 42000,
  });
  publishTestListing({
    id: 'listing:p0-camry-old',
    title: 'تويوتا كامري 2021 هايبرد',
    price: 69000,
    year: 2021,
    mileage: 28000,
  });
  publishTestListing({
    id: 'listing:p0-camry-expensive',
    title: 'تويوتا كامري 2024 هايبرد',
    price: 95000,
    year: 2024,
    mileage: 18000,
  });

  await searchMarketplaceWithState({ ownerKey, query: 'أريد كامري في تبوك' });
  await searchMarketplaceWithState({ ownerKey, query: '2022 وفوق' });
  await searchMarketplaceWithState({ ownerKey, query: 'حدي 80 ألف' });
  const result = await searchMarketplaceWithState({
    ownerKey,
    query: 'الأهم ممشى قليل',
  });

  assert.equal(result.searchState.category, 'cars');
  assert.equal(result.searchState.brand, 'Toyota');
  assert.equal(result.searchState.model, 'Camry');
  assert.equal(result.searchState.city, 'تبوك');
  assert.equal(result.searchState.yearMin, 2022);
  assert.equal(result.searchState.maxPrice, 80000);
  assert.equal(result.searchState.rankingPreferences.includes('mileage'), true);
  assert.equal(
    result.listings.every((ranked) => ranked.listing.price !== 95000),
    true,
  );
  assert.equal(
    result.listings.every((ranked) => ranked.listing.id !== 'listing:p0-camry-old'),
    true,
  );
  assert.equal(result.listings[0]?.listing.id, 'listing:p0-camry-best');

  const relaxedBudget = await searchMarketplaceWithState({
    ownerKey,
    query: 'خل الميزانية 90 ألف',
  });
  assert.equal(relaxedBudget.searchState.maxPrice, 90000);
  assert.equal(relaxedBudget.searchState.model, 'Camry');

  const withoutWhite = await searchMarketplaceWithState({
    ownerKey,
    query: 'لا أريد أبيض',
  });
  assert.equal(withoutWhite.searchState.excludedColors.includes('أبيض'), true);
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

test('retrieval treats feature synonyms as alternatives, not mandatory words', async () => {
  const ownerKey = 'test:search-state-hybrid-synonyms';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-hybrid-arabic',
    title: 'تويوتا كامري 2025 هايبرد',
    price: 79000,
    year: 2025,
    mileage: 22000,
  });

  const result = await searchMarketplaceWithState({
    ownerKey,
    query: 'أريد toyota camry hybrid في تبوك تحت 80 ألف',
  });

  assert.equal(
    result.listings.some((ranked) => ranked.listing.id === 'listing:p0-hybrid-arabic'),
    true,
  );
});

test('retrieval matches Arabic city searches against English stored cities', async () => {
  const ownerKey = 'test:search-state-arabic-english-city';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-camry-english-city',
    title: 'Toyota Camry 2020',
    price: 85000,
    year: 2020,
    mileage: 90000,
    city: 'Riyadh',
  });

  const result = await searchMarketplaceWithState({
    ownerKey,
    query: 'أريد كامري في الرياض',
  });

  assert.equal(
    result.listings.some(
      (ranked) => ranked.listing.id === 'listing:p0-camry-english-city',
    ),
    true,
  );
});
