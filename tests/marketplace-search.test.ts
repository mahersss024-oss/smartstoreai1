import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMarketplaceSearchTermVariants,
  normalizeMarketplaceSearchText,
  parseMarketplaceSearchQuery,
} from '@/agent/marketplace/search';

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
  assert.equal(parsed.termGroups[0].includes('تويوتا'), true);
  assert.equal(parsed.termGroups[0].includes('toyota'), true);
});

test('removes generic words while preserving product attributes', () => {
  const parsed = parseMarketplaceSearchQuery('أريد أبحث عن ساعة زرقاء في الرياض');

  assert.equal(parsed.city, 'الرياض');
  assert.deepEqual(parsed.terms, ['ساعه', 'زرقا']);
});

test('keeps car model year while extracting max price', () => {
  const parsed = parseMarketplaceSearchQuery('كامري 2020 تحت 80000');

  assert.equal(parsed.category, 'cars');
  assert.equal(parsed.maxPrice, 80000);
  assert.deepEqual(parsed.terms, ['كامري', '2020']);
});

test('extracts camera category and brand from Arabic buyer search', () => {
  const parsed = parseMarketplaceSearchQuery('اريد كاميرا تصوير من نوع كانون');

  assert.equal(parsed.category, 'cameras');
  assert.deepEqual(parsed.terms, ['تصوير', 'نوع', 'كانون']);
  assert.equal(parsed.termGroups.at(-1)?.includes('كانون'), true);
  assert.equal(parsed.termGroups.at(-1)?.includes('canon'), true);
});

test('extracts gender supplies categories without falling back to generic fashion', () => {
  const womenParsed = parseMarketplaceSearchQuery('women supplies abaya');
  const menParsed = parseMarketplaceSearchQuery('men supplies shemagh');

  assert.equal(womenParsed.category, 'women_supplies');
  assert.equal(menParsed.category, 'men_supplies');
});

test('expands vehicle brand and model aliases across Arabic and English spellings', () => {
  const nissanVariants = getMarketplaceSearchTermVariants('Nissan');
  const patrolVariants = getMarketplaceSearchTermVariants('بترول');

  assert.equal(nissanVariants.includes('nissan'), true);
  assert.equal(nissanVariants.includes('نيسان'), true);
  assert.equal(patrolVariants.includes('بترول'), true);
  assert.equal(patrolVariants.includes('باترول'), true);
  assert.equal(patrolVariants.includes('patrol'), true);
});

test('normalizes common Arabic writing differences for marketplace search', () => {
  assert.equal(normalizeMarketplaceSearchText('آيفون ١٥'), 'ايفون 15');
  assert.equal(normalizeMarketplaceSearchText('إكس تريل ۲۰۲۵'), 'اكس تريل 2025');
  assert.equal(normalizeMarketplaceSearchText('کیا جدید'), 'كيا جديد');
});

test('expands Arabic definite article and conjunction variants', () => {
  const sofaVariants = getMarketplaceSearchTermVariants('والكنبة');

  assert.equal(sofaVariants.includes('والكنبه'), true);
  assert.equal(sofaVariants.includes('الكنبه'), true);
  assert.equal(sofaVariants.includes('كنبه'), true);
  assert.equal(sofaVariants.includes('كنبة'), true);
});
