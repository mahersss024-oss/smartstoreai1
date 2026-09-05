import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMarketplaceSearchQuery } from '@/agent/marketplace/search';

test('treats search wording as intent and not database search terms', () => {
  const parsed = parseMarketplaceSearchQuery('أبحث عن سيارة في الرياض');

  assert.equal(parsed.category, 'cars');
  assert.equal(parsed.city, 'الرياض');
  assert.deepEqual(parsed.terms, []);
});

test('extracts buyer budget without keeping intent words as terms', () => {
  const parsed = parseMarketplaceSearchQuery(
    'أبحث عن سيارة في الرياض ميزانيتي 50 ألف',
  );

  assert.equal(parsed.category, 'cars');
  assert.equal(parsed.city, 'الرياض');
  assert.equal(parsed.maxPrice, 50000);
  assert.deepEqual(parsed.terms, []);
});

test('keeps real product details as marketplace search terms', () => {
  const parsed = parseMarketplaceSearchQuery('تايوتا كامري 2020');

  assert.equal(parsed.category, 'cars');
  assert.deepEqual(parsed.terms, ['تايوتا', 'كامري', '2020']);
  assert.deepEqual(parsed.termGroups[0], ['تايوتا', 'تويوتا', 'toyota']);
});

test('removes generic words while preserving product attributes', () => {
  const parsed = parseMarketplaceSearchQuery('أريد أبحث عن ساعة زرقاء في الرياض');

  assert.equal(parsed.city, 'الرياض');
  assert.deepEqual(parsed.terms, ['ساعه', 'زرقاء']);
});

test('keeps car model year while extracting max price', () => {
  const parsed = parseMarketplaceSearchQuery('كامري 2020 تحت 80000');

  assert.equal(parsed.category, 'cars');
  assert.equal(parsed.maxPrice, 80000);
  assert.deepEqual(parsed.terms, ['كامري', '2020']);
});
