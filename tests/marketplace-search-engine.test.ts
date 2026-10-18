import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { mockSearchModel } from './helpers/search-model-fixtures';

import {
  rankMarketplaceListings,
  buildRankingWeights,
} from '@/agent/marketplace/ranking-engine';
import { buildRetrievalTermGroups } from '@/agent/marketplace/retrieval-engine';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import {
  getMarketplaceSearchState,
  resetMarketplaceSearchState,
  updateMarketplaceSearchState,
} from '@/agent/marketplace/search-state';
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

test('a repeated product search without explicit refinement drops all prior constraints and restores results', async () => {
  const ownerKey = 'test:independent-same-product-search';
  await resetMarketplaceSearchState(ownerKey);
  const listing = publishTestListing({
    id: 'same-product-fresh-result', title: 'Toyota Camry 2024', price: 90000,
    year: 2024, mileage: 30000, city: 'Riyadh',
  });
  const restrictive = await searchMarketplaceWithState({
    ownerKey, query: 'Toyota Camry', understoodIntent: {
      category: 'cars', brand: 'Toyota', model: 'Camry', city: 'Tabuk',
      minPrice: 1, maxPrice: 100, yearMin: 2020, yearMax: 2021,
      mileageMin: 1, mileageMax: 100, condition: 'new', color: 'black',
      requiredFeatures: ['old_feature'], excludedFeatures: ['hybrid'], excludedColors: ['white'],
      rankingPreferences: ['price'], sortPreference: 'cheapest', locationPreference: 'same_city',
      descriptiveTerms: ['unrelated-old-term'],
    },
  });
  assert.equal(restrictive.listings.some(result => result.listing.id === listing.id), false);
  const fresh = await searchMarketplaceWithState({
    ownerKey, query: 'Toyota Camry',
    understoodIntent: { category: 'cars', brand: 'Toyota', model: 'Camry' },
  });
  const state = await getMarketplaceSearchState(ownerKey);
  assert.equal(fresh.searchState.searchMode, 'new_search');
  for (const field of ['city', 'minPrice', 'maxPrice', 'yearMin', 'yearMax', 'mileageMin', 'mileageMax', 'condition', 'color', 'sortPreference', 'locationPreference'] as const) {
    assert.equal(state?.[field], undefined, field);
  }
  for (const field of ['requiredFeatures', 'excludedFeatures', 'excludedColors', 'rankingPreferences'] as const) {
    assert.deepEqual(state?.[field], [], field);
  }
  assert.deepEqual(state?.terms, [], 'brand and model constraints must not remain duplicated as hidden product terms');
  assert.ok(state);
  assert.deepEqual(buildRetrievalTermGroups(state), [['toyota'], ['camry']]);
  assert.equal(fresh.listings.some(result => result.listing.id === listing.id), true);
});

test('an explicit refinement may add descriptive terms without clearing the current product filters', async () => {
  const ownerKey = 'test:explicit-descriptive-refinement';
  await resetMarketplaceSearchState(ownerKey);
  await updateMarketplaceSearchState(ownerKey, {
    ...parseStructuredSearchIntent('Toyota Camry'), city: 'Riyadh', terms: ['hybrid'],
  });
  const refined = await updateMarketplaceSearchState(ownerKey, {
    ...parseStructuredSearchIntent(''), searchMode: 'refine', terms: ['leather'],
  });
  assert.equal(refined.searchMode, 'refine');
  assert.equal(refined.model, 'Camry');
  assert.equal(refined.city, 'Riyadh');
  assert.deepEqual(refined.terms, ['hybrid', 'leather']);
});

test('database-backed state writes replace prior constraints for an independent search', async () => {
  const { prisma } = await import('@/lib/db/prisma');
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  let stored: unknown = null;
  const delegate = prisma.marketplaceSearchState;
  const original = { findUnique: delegate.findUnique, upsert: delegate.upsert };
  Object.assign(delegate, {
    findUnique: async () => stored ? { state: stored } : null,
    upsert: async (args: { update: { state: unknown } }) => {
      stored = args.update.state;
      return {};
    },
  });
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    await updateMarketplaceSearchState('test:database-independent-search', {
      ...parseStructuredSearchIntent('Toyota Camry'), city: 'Riyadh', maxPrice: 100, terms: ['old'],
    });
    await updateMarketplaceSearchState('test:database-independent-search', parseStructuredSearchIntent('Toyota Camry'));
    const state = await getMarketplaceSearchState('test:database-independent-search');
    assert.equal(state?.searchMode, 'new_search');
    assert.equal(state?.city, undefined);
    assert.equal(state?.maxPrice, undefined);
    assert.deepEqual(state?.terms, []);
  } finally {
    Object.assign(delegate, original);
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  }
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

  await searchMarketplaceWithState({ ownerKey, query: 'كامري', understoodIntent: { city: 'تبوك', category: 'cars', brand: 'تويوتا', model: 'كامري' } });
  await searchMarketplaceWithState({ ownerKey, understoodIntent: { searchMode: 'refine', yearMin: 2022 } });
  await searchMarketplaceWithState({ ownerKey, understoodIntent: { searchMode: 'refine', maxPrice: 80000 } });
  const result = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: { searchMode: 'refine', rankingPreferences: ['mileage'] },
  });

  assert.equal(result.searchState.category, 'cars');
  assert.equal(result.searchState.brand, 'تويوتا');
  assert.equal(result.searchState.model, 'كامري');
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
  assert.equal(
    result.listings.some((ranked) => ranked.listing.id === 'listing:p0-camry-best'),
    true,
  );

  const relaxedBudget = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: { searchMode: 'refine', maxPrice: 90000 },
  });
  assert.equal(relaxedBudget.searchState.maxPrice, 90000);
  assert.equal(relaxedBudget.searchState.model, 'كامري');

  const withoutWhite = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: { searchMode: 'refine', excludedColors: ['أبيض'] },
  });
  assert.equal(withoutWhite.searchState.excludedColors.includes('أبيض'), true);
});

test('refined chat searches replace smart cards with accumulated matching listings', async () => {
  const ownerKey = 'test:search-state-refined-smart-cards';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-camry-2024-refine',
    title: 'Toyota Camry 2024 - Riyadh',
    price: 90000,
    year: 2024,
    mileage: 35000,
    city: 'Riyadh',
    brand: 'Toyota',
    model: 'Camry',
  });
  publishTestListing({
    id: 'listing:p0-camry-2025-budget-refine',
    title: 'Toyota Camry 2025 - Riyadh',
    price: 98000,
    year: 2025,
    mileage: 12000,
    city: 'Riyadh',
    brand: 'Toyota',
    model: 'Camry',
  });
  publishTestListing({
    id: 'listing:p0-camry-2025-expensive-refine',
    title: 'Toyota Camry 2025 - Jeddah',
    price: 135000,
    year: 2025,
    mileage: 9000,
    city: 'Jeddah',
    brand: 'Toyota',
    model: 'Camry',
  });

  const broadResult = await searchMarketplaceWithState({
    ownerKey,
    query: 'Camry',
    understoodIntent: {
      category: 'cars',
      brand: 'Toyota',
      model: 'Camry',
    },
  });
  const broadIds = broadResult.listings.map((ranked) => ranked.listing.id);

  assert.equal(broadResult.searchState.searchMode, 'new_search');
  assert.equal(broadIds.includes('listing:p0-camry-2024-refine'), true);
  assert.equal(broadIds.includes('listing:p0-camry-2025-budget-refine'), true);
  assert.equal(broadIds.includes('listing:p0-camry-2025-expensive-refine'), true);

  const yearResult = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: {
      searchMode: 'refine',
      yearMin: 2025,
      yearMax: 2025,
    },
  });
  const yearIds = yearResult.listings.map((ranked) => ranked.listing.id);

  assert.equal(yearResult.searchState.searchMode, 'refine');
  assert.equal(yearResult.searchState.brand, 'Toyota');
  assert.equal(yearResult.searchState.model, 'Camry');
  assert.equal(yearIds.includes('listing:p0-camry-2024-refine'), false);
  assert.equal(yearIds.includes('listing:p0-camry-2025-budget-refine'), true);
  assert.equal(yearIds.includes('listing:p0-camry-2025-expensive-refine'), true);

  const budgetResult = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: {
      searchMode: 'refine',
      minPrice: 90000,
      maxPrice: 100000,
    },
  });
  const budgetIds = budgetResult.listings.map((ranked) => ranked.listing.id);

  assert.equal(budgetResult.searchState.searchMode, 'refine');
  assert.equal(budgetResult.searchState.yearMin, 2025);
  assert.equal(budgetResult.searchState.yearMax, 2025);
  assert.equal(budgetIds.includes('listing:p0-camry-2025-budget-refine'), true);
  assert.equal(budgetIds.includes('listing:p0-camry-2025-expensive-refine'), false);
  assert.equal(budgetIds.includes('listing:p0-camry-2024-refine'), false);
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

test('retrieval uses the product words and explicit title features supplied by chat', async () => {
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
    query: 'كامري', understoodIntent: { city: 'تبوك', maxPrice: 80000, requiredFeatures: ['هايبرد'] },
  });

  assert.equal(
    result.listings.some((ranked) => ranked.listing.id === 'listing:p0-hybrid-arabic'),
    true,
  );
});

test('retrieval uses the supplied city value without an additional model inference', async () => {
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
    query: 'Camry', understoodIntent: { city: 'Riyadh' },
  });

  assert.equal(
    result.listings.some(
      (ranked) => ranked.listing.id === 'listing:p0-camry-english-city',
    ),
    true,
  );
});

test('retrieval applies literal brand and model constraints without expanding aliases', () => {
  const termGroups = buildRetrievalTermGroups({
    intent: 'search_listing',
    category: 'cars',
    brand: 'Nissan',
    model: 'Patrol',
    requiredFeatures: [],
    excludedFeatures: [],
    excludedColors: [],
    rankingPreferences: [],
    terms: ['نيسان', 'باترول'],
    revision: 1,
    updatedAt: new Date().toISOString(),
  });

  assert.deepEqual(termGroups, [['نيسان'], ['باترول'], ['nissan'], ['patrol']]);
});

test('chat database search does not substitute a contextual synonym for literal product words', async () => {
  const ownerKey = 'test:search-state-nissan-patrol-alias';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-nissan-patrol-arabic',
    title: 'نيسان باترول LE 2025 - تبوك',
    price: 230000,
    year: 2025,
    mileage: 12000,
    brand: 'Nissan',
    model: 'Patrol',
    description: 'نيسان باترول 2025 فل كامل بحالة ممتازة',
  });

  const result = await searchMarketplaceWithState({
    ownerKey,
    query: 'نيسان بترول',
  });
  const intent = parseStructuredSearchIntent('ابي نيسان بترول');

  assert.equal(result.searchState.brand, undefined);
  assert.equal(result.searchState.model, undefined);
  assert.deepEqual(intent.terms, []);
  assert.equal(
    result.listings.some(
      (ranked) => ranked.listing.id === 'listing:p0-nissan-patrol-arabic',
    ),
    false,
  );
});

test('chat supplies product-only words and explicit filters to the database tool', async () => {
  const ownerKey = 'test:search-state-understood-intent-no-raw-words';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-nissan-patrol-understood',
    title: 'Nissan Patrol LE 2025 - Tabuk',
    price: 230000,
    year: 2025,
    mileage: 12000,
    brand: 'Nissan',
    model: 'Patrol',
    city: 'Tabuk',
    description: 'Clean Nissan Patrol 2025 with full service history',
  });

  const result = await searchMarketplaceWithState({
    ownerKey,
    query: 'Nissan Patrol',
    understoodIntent: {
      category: 'cars',
      brand: 'Nissan',
      model: 'Patrol',
      city: 'Tabuk',
    },
  });

  assert.equal(result.searchState.category, 'cars');
  assert.equal(result.searchState.brand, 'Nissan');
  assert.equal(result.searchState.model, 'Patrol');
  assert.deepEqual((await getMarketplaceSearchState(ownerKey))?.terms, []);
  assert.equal(
    result.listings.some(
      (ranked) => ranked.listing.id === 'listing:p0-nissan-patrol-understood',
    ),
    true,
  );
});

test('broad category search starts fresh instead of inheriting old filters', async () => {
  const ownerKey = 'test:search-state-broad-category-resets-old-filters';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-nissan-patrol-old-filter',
    title: 'Nissan Patrol LE 2025 - Tabuk',
    price: 230000,
    year: 2025,
    mileage: 12000,
    brand: 'Nissan',
    model: 'Patrol',
    city: 'Tabuk',
  });
  publishTestListing({
    id: 'listing:p0-toyota-camry-broad-result',
    title: 'Toyota Camry 2022 - Riyadh',
    price: 84000,
    year: 2022,
    mileage: 70000,
    brand: 'Toyota',
    model: 'Camry',
    city: 'Riyadh',
  });

  await searchMarketplaceWithState({
    ownerKey,
    query: 'Nissan Patrol',
    understoodIntent: {
      category: 'cars',
      brand: 'Nissan',
      model: 'Patrol',
      city: 'Tabuk',
    },
  });
  const result = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: { category: 'cars' },
  });
  const storedState = await getMarketplaceSearchState(ownerKey);

  assert.equal(result.searchState.category, 'cars');
  assert.equal(storedState?.searchMode, 'new_search');
  assert.equal(storedState?.brand, undefined);
  assert.equal(storedState?.model, undefined);
  assert.equal(storedState?.city, undefined);
  assert.equal(result.rankedCount >= 2, true);
});

test('changed buyer product intent starts a fresh search without old listing filters', async () => {
  const ownerKey = 'test:search-state-product-intent-change';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-camry-before-house',
    title: 'Toyota Camry 2024 - Riyadh',
    price: 92000,
    year: 2024,
    mileage: 25000,
    city: 'Riyadh',
    brand: 'Toyota',
    model: 'Camry',
  });
  const house = createListingDraft({
    id: 'listing:p0-house-after-car',
    sellerId: 'seller:p0-house-after-car',
    category: 'real_estate',
    title: 'House for sale in Riyadh',
    description: 'Family house with yard',
    price: 900000,
    city: 'Riyadh',
    condition: 'used',
    attributes: {
      type: 'house',
      bedrooms: 4,
    },
  });
  publishListing(house.id);

  await searchMarketplaceWithState({
    ownerKey,
    query: 'Camry',
    understoodIntent: {
      category: 'cars',
      brand: 'Toyota',
      model: 'Camry',
    },
  });
  const refinedCarResult = await searchMarketplaceWithState({
    ownerKey,
    understoodIntent: {
      searchMode: 'refine',
      city: 'Riyadh',
    },
  });

  assert.equal(refinedCarResult.searchState.searchMode, 'refine');
  assert.equal(refinedCarResult.searchState.category, 'cars');
  assert.equal(refinedCarResult.searchState.model, 'Camry');
  assert.equal(refinedCarResult.searchState.city, 'Riyadh');

  const houseResult = await searchMarketplaceWithState({
    ownerKey,
    query: 'house',
    understoodIntent: {
      category: 'real_estate',
    },
  });
  const storedState = await getMarketplaceSearchState(ownerKey);
  const houseIds = houseResult.listings.map((ranked) => ranked.listing.id);

  assert.equal(houseResult.searchState.searchMode, 'new_search');
  assert.equal(storedState?.category, 'real_estate');
  assert.equal(storedState?.brand, undefined);
  assert.equal(storedState?.model, undefined);
  assert.equal(storedState?.city, undefined);
  assert.equal(houseIds.includes('listing:p0-house-after-car'), true);
  assert.equal(houseIds.includes('listing:p0-camry-before-house'), false);
});

test('changed car model starts a fresh search instead of mixing old ad context', async () => {
  const ownerKey = 'test:search-state-car-model-intent-change';
  await resetMarketplaceSearchState(ownerKey);

  publishTestListing({
    id: 'listing:p0-camry-old-context',
    title: 'Toyota Camry 2024 - Riyadh',
    price: 92000,
    year: 2024,
    mileage: 25000,
    city: 'Riyadh',
    brand: 'Toyota',
    model: 'Camry',
  });
  publishTestListing({
    id: 'listing:p0-patrol-new-context',
    title: 'Nissan Patrol 2025 - Jeddah',
    price: 230000,
    year: 2025,
    mileage: 12000,
    city: 'Jeddah',
    brand: 'Nissan',
    model: 'Patrol',
  });

  await searchMarketplaceWithState({
    ownerKey,
    query: 'Toyota Camry',
    understoodIntent: {
      category: 'cars',
      brand: 'Toyota',
      model: 'Camry',
      city: 'Riyadh',
    },
  });
  const patrolResult = await searchMarketplaceWithState({
    ownerKey,
    query: 'Nissan Patrol',
    understoodIntent: {
      category: 'cars',
      brand: 'Nissan',
      model: 'Patrol',
    },
  });
  const storedState = await getMarketplaceSearchState(ownerKey);
  const patrolIds = patrolResult.listings.map((ranked) => ranked.listing.id);

  assert.equal(patrolResult.searchState.searchMode, 'new_search');
  assert.equal(storedState?.brand, 'Nissan');
  assert.equal(storedState?.model, 'Patrol');
  assert.equal(storedState?.city, undefined);
  assert.equal(patrolIds.includes('listing:p0-patrol-new-context'), true);
  assert.equal(patrolIds.includes('listing:p0-camry-old-context'), false);
});

test('structured Arabic search ignores connected brand and model words after extracting intent', () => {
  const intent = parseStructuredSearchIntent('ابي ونيسان والبترول');

  assert.equal(intent.brand, 'Nissan');
  assert.equal(intent.model, 'Patrol');
  assert.deepEqual(intent.terms, []);
});
