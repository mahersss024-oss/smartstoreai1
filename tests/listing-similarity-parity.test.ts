import assert from 'node:assert/strict';
import test from 'node:test';
import { createListingSimilarityScorer, getListingSimilarityScore } from '@/agent/marketplace/listing-similarity';
import { createComparableListingSelector, getComparableListings } from '@/agent/marketplace/market-intelligence';
import { extractListingMileage, extractListingYear } from '@/agent/marketplace/ranking-engine';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import type { ListingRecord } from '@/agent/marketplace/store';
import { getListingSimilarityScore as baselineScore } from './fixtures/listing-similarity-baseline';

function listing(id: string, changes: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id, sellerId: 'seller', category: 'cars', title: 'family sedan clean',
    city: 'Riyadh', attributes: { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry', year: 2020, mileage: 50000 },
    status: 'published', images: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    views: 0, messageCount: 0, favoriteCount: 0,
    compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    ...changes,
  };
}

// Original full-sort behavior, using the frozen scorer and unchanged numeric extractors.
function baselineComparable(target: ListingRecord, candidates: ListingRecord[]) {
  const year = extractListingYear(target);
  const mileage = extractListingMileage(target);
  return candidates.map(candidate => ({ listing: candidate, score: baselineScore(target, candidate) }))
    .filter(({ listing: candidate, score }) => {
      if (candidate.id === target.id || candidate.category !== target.category || score <= 0) return false;
      if (target.city && candidate.city && normalizeMarketplaceSearchText(candidate.city) !== normalizeMarketplaceSearchText(target.city)) return false;
      const candidateYear = extractListingYear(candidate);
      if (year && candidateYear && Math.abs(candidateYear - year) > 3) return false;
      const candidateMileage = extractListingMileage(candidate);
      return !(mileage && candidateMileage && Math.abs(candidateMileage - mileage) > 80_000);
    })
    .sort((a, b) => b.score - a.score || b.listing.updatedAt.localeCompare(a.listing.updatedAt) || b.listing.id.localeCompare(a.listing.id))
    .map(candidate => candidate.listing);
}

const ids = (listings: ListingRecord[]) => listings.map(item => item.id);

test('prepared scorer preserves baseline identity, normalization, qualifier and threshold scores', () => {
  const titles = [
    'family sedan clean', 'commuter vehicle', 'wanted family sedan clean',
    'iphone 13 pro', 'iphone 13 pro max', 'for sale new used', '',
    '\u0643\u0646\u0628 \u0632\u0627\u0648\u064a\u0629 \u0665 \u0642\u0637\u0639', '\u0643\u0646\u0628 \u0632\u0627\u0648\u064a\u0647 5 \u0642\u0637\u0639',
    'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda left one',
    'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda right two',
  ];
  const attributes = [
    {}, { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry' },
    { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'corolla' },
    { brand: 'apple', model: '13' }, { brand: 'Apple', model: 13 },
    { marketplaceCategoryOption: 'tables' }, { marketplaceCategoryOption: 'chairs' },
    { brand: null, model: '', marketplaceCategoryOption: 'other' },
    { brand: 'apple', model: '13', configuration: '256', offerKind: 'sale' },
    { brand: 'apple', model: '13', configuration: '128', offerKind: 'wanted' },
  ];
  const products = ['cars', 'furniture', 'mobile_phones'].flatMap(category =>
    titles.map((title, index) => listing(`${category}:${index}`, { category, title, attributes: attributes[index % attributes.length] })));
  for (const left of products) {
    const prepared = createListingSimilarityScorer(left);
    for (const right of products) {
      const expected = baselineScore(left, right);
      assert.equal(prepared(right), expected, `${left.id} / ${right.id}`);
      assert.equal(getListingSimilarityScore(left, right), expected, `pairwise ${left.id} / ${right.id}`);
    }
  }
});

test('bounded selection matches baseline full sort across batches, ties and a late stronger identity match', () => {
  const target = listing('target');
  const candidates = Array.from({ length: 300 }, (_, index) => listing(`candidate-${String(index).padStart(3, '0')}`, {
    attributes: {},
    updatedAt: index % 4 ? target.updatedAt : '2026-10-02T00:00:00.000Z',
  }));
  candidates[299] = listing('candidate-299', { title: 'commuter vehicle' });
  candidates.push(target, listing('wrong-category', { category: 'furniture' }), listing('wrong-city', { city: 'Jeddah' }));
  const expected = baselineComparable(target, candidates).slice(0, 20);
  assert.equal(expected[0].id, 'candidate-299');
  assert.equal(expected[1].id, 'candidate-296');
  for (const batchSize of [1, 7, 128, 300]) {
    const selected = createComparableListingSelector(target, 20);
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      for (const candidate of candidates.slice(offset, offset + batchSize)) selected.add(candidate);
      assert.ok(selected.list().length <= 20);
    }
    assert.deepEqual(ids(selected.list()), ids(expected));
  }
  assert.deepEqual(ids(getComparableListings(target, candidates)), ids(baselineComparable(target, candidates)));
});

test('description and numeric attributes preserve year, mileage and normalized city gates at their boundaries', () => {
  const identity = { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry' };
  const target = listing('target', { title: 'family sedan', description: 'model 2020 \u0645\u0645\u0634\u0649..................50000', attributes: identity, city: '\u0627\u0644\u0631\u064a\u0627\u0636' });
  const candidates = [
    listing('description-boundary', { title: target.title, description: 'model 2023 \u0645\u0645\u0634\u0649..................130000', attributes: identity, city: '\u0627\u0644\u0631\u0651\u064a\u0627\u0636' }),
    listing('description-year-outside', { title: target.title, description: 'model 2024', attributes: identity, city: target.city }),
    listing('description-mileage-outside', { title: target.title, description: '\u0645\u0645\u0634\u0649..................130001', attributes: identity, city: target.city }),
    listing('attributes-override-description', { title: target.title, description: 'model 2010 \u0645\u0645\u0634\u0649..................500000', attributes: { ...identity, modelYear: '2022', odometer: '60000' }, city: target.city }),
    listing('missing-city-numbers', { title: target.title, attributes: identity, city: undefined }),
    listing('wrong-city', { title: target.title, city: 'Jeddah' }),
  ];
  assert.equal(extractListingYear(target), 2020);
  assert.equal(extractListingMileage(target), 50000);
  const expected = baselineComparable(target, candidates);
  assert.deepEqual(new Set(ids(expected)), new Set(['description-boundary', 'attributes-override-description', 'missing-city-numbers']));
  const selected = createComparableListingSelector(target, 20);
  for (const candidate of candidates) selected.add(candidate);
  assert.deepEqual(ids(selected.list()), ids(expected));
  assert.deepEqual(ids(getComparableListings(target, candidates)), ids(expected));
  // Whitespace-only cities are truthy before normalization and must still gate.
  const blankCity = { ...target, city: '  ' };
  assert.deepEqual(ids(getComparableListings(blankCity, candidates)), ids(baselineComparable(blankCity, candidates)));
});

test('one selection pass prepares the target once and never rescores retained candidates', () => {
  let targetReads = 0;
  const target = listing('target');
  Object.defineProperty(target, 'title', { get: () => { targetReads++; return 'family sedan clean'; } });
  const candidates = Array.from({ length: 300 }, (_, index) => listing(`candidate-${index}`));
  const expected = baselineComparable(target, candidates).slice(0, 20);
  targetReads = 0;
  const candidateReads = candidates.map(() => 0);
  for (const [index, candidate] of candidates.entries()) {
    Object.defineProperty(candidate, 'title', { get: () => { candidateReads[index]++; return 'family sedan clean'; } });
  }
  const selected = createComparableListingSelector(target, 20);
  const preparationReads = targetReads;
  assert.ok(preparationReads > 0);
  for (const candidate of candidates) selected.add(candidate);
  assert.deepEqual(ids(selected.list()), ids(expected));
  assert.equal(targetReads, preparationReads);
  assert.ok(candidateReads.every(reads => reads === 1));
});

test('conflicting identities are rejected before candidate title tokenization', () => {
  const target = listing('target');
  const candidate = listing('different-model', { attributes: { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'corolla' } });
  let titleReads = 0;
  Object.defineProperty(candidate, 'title', { get: () => { titleReads++; return 'family sedan clean'; } });
  const selected = createComparableListingSelector(target, 20);
  selected.add(candidate);
  assert.deepEqual(selected.list(), []);
  assert.equal(titleReads, 0);
});
