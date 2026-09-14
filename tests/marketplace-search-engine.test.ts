import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  rankMarketplaceListings,
  buildRankingWeights,
} from '@/agent/marketplace/ranking-engine';
import { buildRetrievalTermGroups } from '@/agent/marketplace/retrieval-engine';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import {
  getMarketplaceSearchState,
  resetMarketplaceSearchState,
} from '@/agent/marketplace/search-state';
import { parseStructuredSearchIntent } from '@/agent/marketplace/structured-search-intent';
import {
  createListingDraft,
  publishListing,
  resetMarketplaceStoreForTests,
  type ListingRecord,
} from '@/agent/marketplace/store';

beforeEach(() => {
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
  assert.equal(
    result.listings.some((ranked) => ranked.listing.id === 'listing:p0-camry-best'),
    true,
  );

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
    query: 'I want a Camry',
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
    query: 'model 2025',
    understoodIntent: {
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
    query: 'between 90000 and 100000',
    understoodIntent: {
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

test('retrieval expands structured brand and model aliases before database filtering', () => {
  const termGroups = buildRetrievalTermGroups({
    intent: 'search_listing',
    category: 'cars',
    brand: 'Nissan',
    model: 'Patrol',
    requiredFeatures: [],
    excludedFeatures: [],
    excludedColors: [],
    rankingPreferences: [],
    terms: [],
    revision: 1,
    updatedAt: new Date().toISOString(),
  });

  assert.equal(termGroups[0].includes('nissan'), true);
  assert.equal(termGroups[0].includes('نيسان'), true);
  assert.equal(termGroups[1].includes('patrol'), true);
  assert.equal(termGroups[1].includes('باترول'), true);
  assert.equal(termGroups[1].includes('بترول'), true);
});

test('chat marketplace search finds Nissan Patrol when the buyer writes petrol spelling', async () => {
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
    query: 'ابي نيسان بترول',
  });
  const intent = parseStructuredSearchIntent('ابي نيسان بترول');

  assert.equal(result.searchState.brand, 'Nissan');
  assert.equal(result.searchState.model, 'Patrol');
  assert.deepEqual(intent.terms, []);
  assert.equal(
    result.listings.some(
      (ranked) => ranked.listing.id === 'listing:p0-nissan-patrol-arabic',
    ),
    true,
  );
});

test('chat marketplace search uses understood intent instead of raw query words', async () => {
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
    query:
      'Please check if SmartStore AI has a published listing card for a Nissan Patrol and do not just search these words.',
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
    query: 'Nissan Patrol in Tabuk',
    understoodIntent: {
      category: 'cars',
      brand: 'Nissan',
      model: 'Patrol',
      city: 'Tabuk',
    },
  });
  const result = await searchMarketplaceWithState({
    ownerKey,
    query: 'I want a car',
  });
  const storedState = await getMarketplaceSearchState(ownerKey);

  assert.equal(result.searchState.category, 'cars');
  assert.equal(storedState?.searchMode, 'new_search');
  assert.equal(storedState?.brand, undefined);
  assert.equal(storedState?.model, undefined);
  assert.equal(storedState?.city, undefined);
  assert.equal(result.rankedCount >= 2, true);
});

test('structured Arabic search ignores connected brand and model words after extracting intent', () => {
  const intent = parseStructuredSearchIntent('ابي ونيسان والبترول');

  assert.equal(intent.brand, 'Nissan');
  assert.equal(intent.model, 'Patrol');
  assert.deepEqual(intent.terms, []);
});
