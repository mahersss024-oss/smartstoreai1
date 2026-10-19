import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { GET as getAdminListings } from '@/app/api/admin/listings/route';
import { marketplaceCategoryDefinitions } from '@/lib/marketplace/categories';
import {
  getListingCategoryOption, getMarketplaceCategoryOption, getMarketplaceCategoryOptionLabel,
  getMarketplaceCategoryOptions, InvalidMarketplaceCategoryOptionError, marketplaceCategoryOptionAttribute,
  marketplaceCategoryOptionGroups, mergeMarketplaceCategoryAttributes,
} from '@/lib/marketplace/category-options';
import { publicListingFiltersSql } from '@/lib/marketplace/title-search';
import { createSessionCookie } from '@/lib/auth/session';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { parseListingCategoryModelOutput, createListingCategoryClassifier } from '@/agent/marketplace/listing-category-model';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import {
  createListingDraft, getListing, listPublicMarketplaceListings, resetMarketplaceStoreForTests,
  setListingStatusForSeller, updateListingForSeller,
} from '@/agent/marketplace/store';
import { GET, POST } from '@/app/api/marketplace/listings/route';
import { PATCH } from '@/app/api/marketplace/listings/[listingId]/route';
import { mockAllowedTextAnalysis, textAnalysis } from './helpers/text-understanding';

beforeEach(t => { resetMarketplaceStoreForTests(); mockAllowedTextAnalysis(t); });
const attr = marketplaceCategoryOptionAttribute;

test('all catalog categories have one flat shared option group, without clothing brands or lost-and-found', () => {
  assert.deepEqual(Object.keys(marketplaceCategoryOptionGroups).sort(), marketplaceCategoryDefinitions.map(category => category.id).sort());
  for (const category of marketplaceCategoryDefinitions) {
    const choices = getMarketplaceCategoryOptions(category.id);
    assert.equal(new Set(choices.map(choice => choice.id)).size, choices.length, category.id);
    assert.equal(new Set(choices.map(choice => choice.label)).size, choices.length, category.id);
    assert.ok(category.id === 'other' || choices.length > 0, category.id);
    for (const choice of choices) {
      assert.match(choice.id, /^[a-z][a-z0-9_]*$/);
      assert.match(choice.label, /[\u0600-\u06ff]/);
      assert.deepEqual(Object.keys(choice).sort(), ['id', 'label']);
      assert.equal(getMarketplaceCategoryOption(category.id, choice.id), choice);
    }
  }
  for (const category of ['fashion', 'women_supplies', 'men_supplies', 'kids']) {
    assert.equal(getMarketplaceCategoryOptionLabel(category), 'النوع');
    assert.equal(getMarketplaceCategoryOption(category, 'zara'), undefined);
  }
  assert.equal(getMarketplaceCategoryOptionLabel('cars'), 'البراند');
  assert.equal(getMarketplaceCategoryOption('real_estate', 'shops_transfer')?.label, 'محلات للتنازل');
  assert.ok(!JSON.stringify(marketplaceCategoryDefinitions).includes('مفقودات'));
  assert.deepEqual(getMarketplaceCategoryOptions('lost_found'), []);
});

test('category option writes validate membership, preserve unrelated details, and clear on removal or category change', () => {
  const previous = { category: 'mobile_phones', attributes: { [attr]: 'apple', color: 'grey', warranty: 'confirmed' } };
  assert.equal(getListingCategoryOption(previous)?.label, 'آبل');
  assert.deepEqual(mergeMarketplaceCategoryAttributes('mobile_phones', { conditionNote: 'clean' }, previous), { ...previous.attributes, conditionNote: 'clean' });
  assert.deepEqual(mergeMarketplaceCategoryAttributes('cars', {}, previous), { color: 'grey', warranty: 'confirmed' });
  assert.deepEqual(mergeMarketplaceCategoryAttributes('mobile_phones', { [attr]: null }, previous), { color: 'grey', warranty: 'confirmed' });
  assert.throws(() => mergeMarketplaceCategoryAttributes('cars', { [attr]: 'apple' }), InvalidMarketplaceCategoryOptionError);
  assert.throws(() => mergeMarketplaceCategoryAttributes('fashion', { [attr]: 'nike' }), InvalidMarketplaceCategoryOptionError);
  assert.throws(() => mergeMarketplaceCategoryAttributes('cars', { [attr]: { id: 'toyota' } }), InvalidMarketplaceCategoryOptionError);
  assert.equal(getListingCategoryOption({ category: 'cars', attributes: { [attr]: 'apple' } }), undefined);
  assert.equal(getListingCategoryOption({ category: 'mobile_phones', attributes: { brand: 'Apple' } }), undefined, 'legacy text is not inferred or rewritten');
  const canonical = mergeMarketplaceCategoryAttributes('mobile_phones', { [attr]: 'apple', brand: 'Apple', color: 'grey' });
  assert.equal(canonical.brand, 'آبل');
  assert.equal(mergeMarketplaceCategoryAttributes('mobile_phones', { [attr]: 'samsung' }, { category: 'mobile_phones', attributes: canonical }).brand, 'سامسونج');
  assert.equal(mergeMarketplaceCategoryAttributes('mobile_phones', { [attr]: null }, { category: 'mobile_phones', attributes: canonical }).brand, undefined);
  assert.equal(mergeMarketplaceCategoryAttributes('furniture', {}, { category: 'mobile_phones', attributes: canonical }).brand, undefined);
  assert.equal(mergeMarketplaceCategoryAttributes('fashion', { [attr]: 'women_clothing', brand: 'Seller confirmed brand' }).brand, 'Seller confirmed brand');
});

test('every catalog brand/type survives saving, editing, publication and exact public filtering', () => {
  for (const category of marketplaceCategoryDefinitions) {
    const sellerId = `options-${category.id}`;
    for (const option of getMarketplaceCategoryOptions(category.id)) {
      const listing = createListingDraft({ sellerId, category: category.id, title: option.label, attributes: { [attr]: option.id, color: 'original' } });
      assert.equal(getListingCategoryOption(listing)?.id, option.id);
      const edited = updateListingForSeller(listing.id, sellerId, { description: 'Confirmed details' })!;
      assert.equal(getListingCategoryOption(edited)?.id, option.id);
      setListingStatusForSeller(listing.id, sellerId, 'published');
      const results = listPublicMarketplaceListings({ category: category.id, categoryOption: option.id, take: 100 });
      assert.deepEqual(results.map(item => item.id), [listing.id]);
      assert.ok(results.every(item => item.category === category.id));
      setListingStatusForSeller(listing.id, sellerId, 'deleted');
    }
  }
});

test('public brand/type filters combine with title, city and pagination without consulting a model', async t => {
  const save = (id: string, category: string, value?: string, city = 'الرياض') => {
    createListingDraft({ id, sellerId: id, category, title: 'منتج تجريبي', city, attributes: value ? { [attr]: value } : {} });
    setListingStatusForSeller(id, id, 'published');
  };
  save('phone-apple', 'mobile_phones', 'apple');
  save('phone-samsung', 'mobile_phones', 'samsung');
  save('tablet-apple', 'tablets', 'apple');
  save('legacy-phone', 'mobile_phones');
  save('phone-jeddah', 'mobile_phones', 'apple', 'جدة');
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Unexpected search model'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('Unexpected model cache'); });
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const response = await GET(new Request('https://example.test/api/marketplace/listings?category=mobile_phones&categoryOption=apple&city=' + encodeURIComponent('الرياض') + '&q=' + encodeURIComponent('تجريبي') + '&limit=1'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.listings.map((item: { id: string }) => item.id), ['phone-apple']);
  for (const query of ['categoryOption=apple', 'category=cars&categoryOption=apple', 'category=fashion&categoryOption=nike']) {
    assert.equal((await GET(new Request('https://example.test/api/marketplace/listings?' + query))).status, 400);
  }
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(peek.mock.callCount(), 0);
});

test('database option filtering uses exact parameterized JSON values before pagination', () => {
  const value = "apple' OR TRUE --";
  const sql = Prisma.sql`${publicListingFiltersSql({ category: 'mobile_phones', categoryOption: value })}`;
  assert.ok(sql.text.includes('"category" ='));
  assert.ok(sql.text.includes('"attributes" ->>'));
  assert.ok(sql.values.includes(attr));
  assert.ok(sql.values.includes(value));
  assert.ok(!sql.text.includes(value));
});

test('admin filters use the same exact category and JSON option for both rows and totals', async t => {
  const reads: Array<{ where: unknown; skip?: number }> = [];
  const find = prisma.listing.findMany;
  const count = prisma.listing.count;
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  prisma.listing.findMany = t.mock.fn(async (args: unknown) => { reads.push(args as typeof reads[number]); return []; }) as typeof find;
  prisma.listing.count = t.mock.fn(async (args: unknown) => { reads.push(args as typeof reads[number]); return 0; }) as typeof count;
  t.after(() => {
    prisma.listing.findMany = find; prisma.listing.count = count;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  });
  const headers = { cookie: createSessionCookie({ id: 'catalog-admin', email: 'catalog-admin@example.test', role: 'admin' }) };
  const response = await getAdminListings(new Request('https://example.test/api/admin/listings?category=real_estate&categoryOption=shops_transfer&status=published&page=2&limit=10', { headers }));
  assert.equal(response.status, 200);
  assert.deepEqual(reads[0].where, { category: 'real_estate', attributes: { path: [attr], equals: 'shops_transfer' }, status: 'published' });
  assert.deepEqual(reads[1].where, reads[0].where);
  assert.equal(reads[0].skip, 10);
  assert.equal((await getAdminListings(new Request('https://example.test/api/admin/listings?category=cars&categoryOption=apple', { headers }))).status, 400);
  assert.equal(reads.length, 2, 'invalid filters do not reach the database');
});

test('HTTP creation and editing save valid options and reject cross-category values without mutation', async t => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const seller = { id: 'http-category-option', email: 'category-options@example.test' };
  const request = (method: string, body: unknown, actor = seller) => new Request('https://example.test/api/marketplace/listings', {
    method, headers: { 'Content-Type': 'application/json', Cookie: createSessionCookie(actor).split(';')[0] }, body: JSON.stringify(body),
  });
  const created = await POST(request('POST', { category: 'mobile_phones', title: 'جوال تجريبي', attributes: { [attr]: 'apple', color: 'grey' } }));
  assert.equal(created.status, 201);
  const { listing } = await created.json();
  const context = { params: Promise.resolve({ listingId: listing.id }) };
  const invalid = await PATCH(request('PATCH', { attributes: { [attr]: 'toyota' } }), context);
  assert.equal(invalid.status, 400);
  assert.equal(getListingCategoryOption(getListing(listing.id)!)?.id, 'apple');
  assert.equal((await PATCH(request('PATCH', { attributes: { [attr]: 'samsung' } }, { id: 'other-owner', email: 'other@example.test' }), context)).status, 404);
  assert.equal((await PATCH(request('PATCH', { attributes: { [attr]: null } }), context)).status, 200);
  assert.equal(getListingCategoryOption(getListing(listing.id)!), undefined);
  assert.equal(getListing(listing.id)?.attributes.color, 'grey');
  assert.equal((await PATCH(request('PATCH', { attributes: { [attr]: 'apple' } }), context)).status, 200);
  assert.equal((await PATCH(request('PATCH', { category: 'cars' }), context)).status, 200);
  assert.equal(getListingCategoryOption(getListing(listing.id)!), undefined);
  assert.equal(getListing(listing.id)?.id, listing.id);
  assert.equal((await POST(request('POST', { category: 'cars', title: 'إعلان غير صحيح', attributes: { [attr]: 'apple' } }))).status, 400);
});

test('model classification accepts only an option belonging to its category and never guesses missing choices', async t => {
  assert.deepEqual(parseListingCategoryModelOutput(JSON.stringify({ category: 'cars', confidence: 0.95, categoryOption: 'toyota' })), { category: 'cars', status: 'suggested', categoryOption: 'toyota' });
  assert.deepEqual(parseListingCategoryModelOutput(JSON.stringify({ category: 'cars', confidence: 0.95, categoryOption: 'apple' })), { category: 'cars', status: 'suggested' });
  assert.deepEqual(parseListingCategoryModelOutput(JSON.stringify({ category: 'fashion', confidence: 0.95, categoryOption: 'zara' })), { category: 'fashion', status: 'suggested' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => textAnalysis({ category: 'real_estate', categoryOption: 'shops_transfer' }));
  assert.deepEqual(await createListingCategoryClassifier().suggest({ title: 'محل للتنازل', description: '' }), { category: 'real_estate', status: 'suggested', categoryOption: 'shops_transfer' });
});

test('Hamad uses the same optional brand/type catalog for owned drafts only', async () => {
  const tools = createMarketplaceTools({ issuedAt: 1, expiresAt: 9999999999, user: { id: 'hamad-category-options', email: 'hamad-options@example.test' } });
  const create = tools.createListingDraft.execute as unknown as (input: Record<string, unknown>, context: object) => Promise<{ status: string; listing?: { id: string; category: string; attributes: Record<string, unknown> } }>;
  const invalid = await create({ category: 'cars', categoryOption: 'apple', title: 'سيارة' }, {});
  assert.equal(invalid.status, 'invalid_category_option');
  const saved = await create({ category: 'cars', categoryOption: 'toyota', title: 'سيارة تويوتا' }, {});
  assert.equal(saved.status, 'draft_created');
  assert.equal(getListingCategoryOption(saved.listing!)?.id, 'toyota');
  assert.equal(getListing(saved.listing!.id)?.status, 'draft');
  const edit = tools.updateListing.execute as unknown as (input: Record<string, unknown>, context: object) => Promise<{ status: string; listing?: { category: string; attributes: Record<string, unknown> } }>;
  assert.equal((await edit({ listingId: saved.listing!.id, categoryOption: 'apple' }, {})).status, 'invalid_category_option');
  const cleared = await edit({ listingId: saved.listing!.id, categoryOption: null }, {});
  assert.equal(cleared.status, 'updated');
  assert.equal(getListingCategoryOption(cleared.listing!), undefined);
  assert.ok(!('searchMarketplaceListings' in tools));
  assert.ok(!('compareMarketplaceListings' in tools));
});
