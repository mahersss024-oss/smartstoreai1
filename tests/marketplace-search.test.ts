import assert from 'node:assert/strict';
import test from 'node:test';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';
import { getMarketplaceSearchTermVariants, normalizeMarketplaceSearchText, parseMarketplaceSearchQuery } from '@/agent/marketplace/search';

test('search uses contextual model fields instead of extracting keywords locally', t => {
  const output = textAnalysis({ category: 'cars', brand: 'Toyota', model: 'Camry',
    aliases: [{ term: 'Toyota', variants: ['تويوتا', 'تايوتا', 'toyota'] }],
    search: { ...textAnalysis().search, city: 'الرياض', maxPrice: 80000, yearMin: 2020, yearMax: 2020 },
  });
  const query = 'أبحث عن تايوتا كامري 2020 في الرياض تحت 80 ألف';
  t.mock.method(marketplaceTextAnalyzer, 'peek', (text: string) => text === query ? output : null);
  const parsed = parseMarketplaceSearchQuery(query);
  assert.equal(parsed.category, 'cars');
  assert.equal(parsed.city, 'الرياض');
  assert.equal(parsed.maxPrice, 80000);
  assert.equal(parsed.yearMin, 2020);
  assert.deepEqual(parsed.terms, ['Toyota', 'Camry']);
  assert.ok(parsed.termGroups[0].includes('تويوتا'));
  assert.ok(parsed.termGroups[0].includes('toyota'));
});

test('broad model category requests do not turn request wording into product terms', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ category: 'cars' }));
  assert.deepEqual(parseMarketplaceSearchQuery('أبحث عن سيارة').terms, []);
});

test('model color and feature constraints remain searchable', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ category: 'watches_accessories',
    search: { ...textAnalysis().search, color: 'blue', requiredFeatures: ['waterproof'] },
  }));
  assert.deepEqual(parseMarketplaceSearchQuery('أريد ساعة زرقاء مقاومة للماء').terms, ['blue', 'waterproof']);
});

test('unknown text stays literal without a guessed category city or budget', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  const parsed = parseMarketplaceSearchQuery('unknown object 2020');
  assert.equal(parsed.category, undefined);
  assert.equal(parsed.city, undefined);
  assert.equal(parsed.minPrice, undefined);
  assert.equal(parsed.maxPrice, undefined);
  assert.deepEqual(parsed.terms, ['unknown', 'object', '2020']);
});

test('only contextual equivalents from the model expand a search term', t => {
  const output = textAnalysis({ aliases: [{ term: 'Patrol', variants: ['بترول', 'باترول', 'patrol'] }] });
  t.mock.method(marketplaceTextAnalyzer, 'peek', (text: string) => text === 'vehicle request' ? output : null);
  assert.ok(getMarketplaceSearchTermVariants('Patrol', 'vehicle request').includes('باترول'));
  assert.ok(!getMarketplaceSearchTermVariants('Patrol', 'fuel request').includes('باترول'));
});

test('normalizes common writing and digit differences without semantic dictionaries', () => {
  assert.equal(normalizeMarketplaceSearchText('آيفون ١٥'), 'ايفون 15');
  assert.equal(normalizeMarketplaceSearchText('إكس تريل ۲۰۲۵'), 'اكس تريل 2025');
  assert.equal(normalizeMarketplaceSearchText('کیا جدید'), 'كيا جديد');
});
