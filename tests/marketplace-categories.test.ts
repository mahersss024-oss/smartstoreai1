import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeEach } from 'node:test';
import { mockAllowedTextAnalysis, textAnalysis } from './helpers/text-understanding';
import { marketplaceTextAnalyzer, marketplaceTextAnalysisSchema } from '@/agent/marketplace/text-understanding';

beforeEach(mockAllowedTextAnalysis);
import {
  formatMarketplaceCategory, getMarketplaceCategorySearchIds, isMarketplaceCategory,
  marketplaceCategoryDefinitions, marketplaceCategoryGroups, marketplaceCategoryIds,
} from '@/lib/marketplace/categories';
import { resolveListingCategory } from '@/agent/marketplace/listing-category';
import { parseMarketplaceSearchQuery } from '@/agent/marketplace/search';
import { inferExpectedMarketplaceCategory } from '@/agent/marketplace/vision-compliance';
import { systemPrompt } from '@/agent/system-prompt';
import { marketplaceSystemInstructions } from '@/agent/marketplace/agents';
import { createListingDraft, listMarketplaceListings, setListingStatusForSeller, updateListingForSeller } from '@/agent/marketplace/store';

const legacyIds = [
  'cars', 'auto_parts', 'mobile_phones', 'computers', 'real_estate', 'furniture',
  'fashion', 'women_supplies', 'men_supplies', 'kids', 'home_garden', 'sports',
  'gaming_hobbies', 'books_education', 'tools_equipment', 'watches_accessories', 'beauty', 'other',
];

test('category catalog preserves legacy IDs, has unique labels and groups every category exactly once', () => {
  assert.equal(new Set(marketplaceCategoryIds).size, marketplaceCategoryIds.length);
  const labels = marketplaceCategoryDefinitions.map(category => category.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(marketplaceCategoryGroups.flatMap(group => group.categories).sort(), [...labels].sort());
  for (const id of legacyIds) assert.ok(isMarketplaceCategory(id), id);
  for (const id of ['jobs', 'services', 'travel', 'training', 'businesses', 'events', 'boats', 'building_materials', 'business_equipment']) assert.equal(isMarketplaceCategory(id), true);
  for (const id of ['lost_found', 'investments']) assert.equal(isMarketplaceCategory(id), false);
  assert.equal(formatMarketplaceCategory('computers'), 'الحواسيب وملحقاتها');
  assert.equal(formatMarketplaceCategory('legacy-custom-category'), 'legacy-custom-category');
  assert.equal(resolveListingCategory({ category: 'legacy-custom-category', title: 'iPhone' }), 'legacy-custom-category');
});

for (const category of marketplaceCategoryDefinitions) {
  test(`shared category ${category.id} remains usable through draft, edit, publication and explicit filtering`, () => {
    const sellerId = `catalog-${category.id}`;
    const listing = createListingDraft({ sellerId, category: category.id, title: 'Catalog fixture item', price: 100 });
    assert.equal(listing.category, category.id);
    assert.equal(formatMarketplaceCategory(listing.category), category.label);
    assert.equal(updateListingForSeller(listing.id, sellerId, { description: 'Catalog fixture details' })?.category, category.id);
    assert.equal(setListingStatusForSeller(listing.id, sellerId, 'published')?.status, 'published');
    assert.ok(listMarketplaceListings({ category: category.id, take: 100 }).some(item => item.id === listing.id));
    assert.ok(systemPrompt.includes(`${category.id} (${category.label})`));
    assert.ok(marketplaceSystemInstructions.includes(`${category.id} (${category.label})`));
  });
}

const goodsExamples = [
  ['cameras', 'Canon camera'], ['tablets', 'iPad tablet'],
  ['home_appliances', 'قلاية هوائية'], ['tv_audio', 'تلفزيون'],
  ['networking', 'راوتر'], ['motorcycles', 'دراجة نارية'],
  ['heavy_equipment', 'معدات ثقيلة'], ['agriculture', 'شتلات'],
  ['animals', 'اعلاف'], ['camping', 'خيمة'], ['food', 'تمور'],
  ['antiques', 'تراثيات'], ['arts', 'أدوات رسم'],
] as const;

for (const [id, title] of goodsExamples) {
  test(`search and image context consume the same model category ${id}, storage preserves the supplied category`, t => {
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ category: id }));
    assert.equal(parseMarketplaceSearchQuery(title).category, id);
    assert.equal(resolveListingCategory({ category: id, autoCategory: true, title }), id);
    assert.equal(inferExpectedMarketplaceCategory(title), id);
    assert.equal(resolveListingCategory({ category: id, autoCategory: true, title: 'Unspecified', description: title }), id);
    assert.equal(resolveListingCategory({ category: 'furniture', title }), 'furniture');
  });
}

test('shared model category schema accepts every catalog ID and rejects invented categories', () => {
  for (const category of marketplaceCategoryIds) assert.equal(textAnalysis({ category }).category, category);
  assert.equal(marketplaceTextAnalysisSchema.safeParse({ ...textAnalysis(), category: 'invented-category' }).success, false);
});

test('search and image context honor model decisions instead of classifying word fragments', t => {
  for (const [title, expected] of [
    ['قابل للتفاوض ساعة', 'watches_accessories'],
    ['نقطة وصول راوتر', 'networking'],
    ['طاولة فرنسية', 'furniture'],
    ['black watch', 'watches_accessories'],
    ['ابل ماكبوك', 'computers'],
    ['ابل ايفون', 'mobile_phones'],
    ['قطة صغيرة', 'animals'],
    ['Canon camera', 'cameras'],
  ] as const) {
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ category: expected }));
    assert.equal(parseMarketplaceSearchQuery(title).category, expected, title);
    assert.equal(inferExpectedMarketplaceCategory(title), expected, title);
  }
});

test('model categories retain older broad listings without rewriting or widening explicit category filters', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ category: 'home_appliances', search: { ...textAnalysis().search, descriptiveTerms: ['مرجعتصنيف'] } }));
  const listings = ['other', 'home_garden', 'home_appliances'].map(category => {
    const sellerId = `legacy-appliance-${category}`;
    const listing = createListingDraft({ sellerId, category, title: 'غلاية مرجعتصنيف', price: 50 });
    setListingStatusForSeller(listing.id, sellerId, 'published');
    return listing;
  });
  const results = listMarketplaceListings({ query: 'غلاية مرجعتصنيف', take: 100 });
  for (const listing of listings) assert.ok(results.some(item => item.id === listing.id), listing.category);
  const explicit = listMarketplaceListings({ category: 'home_appliances', query: 'غلاية مرجعتصنيف', take: 100 });
  assert.ok(explicit.some(item => item.id === listings[2].id));
  assert.ok(explicit.every(item => item.category === 'home_appliances'));
  assert.deepEqual(listings.map(item => item.category), ['other', 'home_garden', 'home_appliances']);
  assert.deepEqual(getMarketplaceCategorySearchIds('legacy-custom-category'), ['legacy-custom-category']);
});

test('manual category selection does not attach unrelated model concerns', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ category: 'food', compliance: { decision: 'block', reasons: ['prohibited_product'], shariaSensitive: true } }));
  const listing = createListingDraft({ sellerId: 'catalog-policy', category: 'food', title: 'مشروب كحولي للبيع' });
  assert.equal(listing.status, 'draft');
  assert.equal(listing.compliance.modelAssessment, undefined);
});

test('database searches use the same legacy category expansion and keep explicit filters exact', async t => {
  const resultFor = (text: string) => textAnalysis({ category: text === 'Canon camera' ? 'cameras' : 'home_appliances', search: { ...textAnalysis().search, descriptiveTerms: ['fixture-product'] } });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async (text: string) => resultFor(text));
  t.mock.method(marketplaceTextAnalyzer, 'peek', resultFor);
  const { prisma } = await import('@/lib/db/prisma');
  const { listMarketplaceListings: listFromRepository } = await import('@/agent/marketplace/repository');
  const reads: Array<{ where: { AND: unknown[] } }> = [];
  const originalFindMany = prisma.listing.findMany;
  // Prisma exposes delegate methods through a proxy, without own method descriptors.
  prisma.listing.findMany = t.mock.fn(async (options: unknown) => {
    reads.push(options as { where: { AND: unknown[] } });
    return [];
  }) as typeof prisma.listing.findMany;
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    await listFromRepository({ query: 'غلاية مرجعتصنيف' });
    assert.deepEqual(reads[0].where.AND[0], { category: { in: getMarketplaceCategorySearchIds('home_appliances') } });
    await listFromRepository({ query: 'غلاية مرجعتصنيف', category: 'home_appliances' });
    assert.deepEqual(reads[1].where.AND[0], { category: 'home_appliances' });
    await listFromRepository({ query: 'Canon camera' });
    assert.deepEqual(reads[2].where.AND[0], { category: { in: getMarketplaceCategorySearchIds('cameras') } });
    await listFromRepository({ category: 'legacy-custom-category' });
    assert.deepEqual(reads[3].where.AND[0], { category: 'legacy-custom-category' });
  } finally {
    prisma.listing.findMany = originalFindMany;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
