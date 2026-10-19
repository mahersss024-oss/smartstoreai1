import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createSessionCookie } from '@/lib/auth/session';
import { getHomeBrowseKey } from '@/lib/marketplace/home-browse-state';
import { getMarketplaceCarModel, getMarketplaceCarModels, marketplaceCarModelAttribute as modelAttr, marketplaceCarModelsByBrand } from '@/lib/marketplace/car-models';
import { getListingCarModel, getMarketplaceCategoryOptions, marketplaceCategoryOptionAttribute as brandAttr, mergeMarketplaceCategoryAttributes, InvalidMarketplaceCategoryOptionError } from '@/lib/marketplace/category-options';
import { publicListingFiltersSql } from '@/lib/marketplace/title-search';
import { GET, POST } from '@/app/api/marketplace/listings/route';
import { PATCH } from '@/app/api/marketplace/listings/[listingId]/route';
import { GET as adminGet } from '@/app/api/admin/listings/route';
import { PATCH as adminPatch } from '@/app/api/admin/listings/[listingId]/route';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { createListingCategoryClassifier, parseListingCategoryModelOutput } from '@/agent/marketplace/listing-category-model';
import { createListingDraft, getListing, listPublicMarketplaceListings, resetMarketplaceStoreForTests, setListingStatusForSeller, updateListingForSeller } from '@/agent/marketplace/store';
import { mockAllowedTextAnalysis, textAnalysis } from './helpers/text-understanding';

beforeEach(t => {
  if (!('after' in t)) throw new Error('Car catalog checks require a test context');
  resetMarketplaceStoreForTests();
  mockAllowedTextAnalysis(t);
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
});

test('every named car brand has model families with unique IDs and an escape choice, without years or trims', () => {
  const brands = getMarketplaceCategoryOptions('cars').filter(brand => brand.id !== 'other');
  assert.deepEqual(Object.keys(marketplaceCarModelsByBrand).sort(), brands.map(brand => brand.id).sort());
  for (const brand of brands) {
    const choices = getMarketplaceCarModels(brand.id);
    assert.ok(choices.length >= 2, brand.id);
    assert.equal(new Set(choices.map(choice => choice.id)).size, choices.length, brand.id);
    assert.equal(new Set(choices.map(choice => choice.label)).size, choices.length, brand.id);
    assert.equal(choices.at(-1)?.id, 'other');
    for (const choice of choices) {
      assert.match(choice.id, /^[a-z0-9_]+$/);
      assert.match(choice.label, /^[\u0600-\u06ff\d\s-]+$/);
      assert.deepEqual(Object.keys(choice).sort(), ['id', 'label']);
      assert.equal(getMarketplaceCarModel(brand.id, choice.id), choice);
    }
  }
  assert.deepEqual(getMarketplaceCarModels('other'), []);
  assert.deepEqual(getMarketplaceCarModels('__proto__'), []);
  for (const id of ['camry', 'corolla', 'hilux']) assert.ok(getMarketplaceCarModel('toyota', id));
  for (const id of ['patrol', 'sunny', 'altima']) assert.ok(getMarketplaceCarModel('nissan', id));
});

test('model writes validate the category and brand, preserve other details, and clear stale catalog-controlled values', () => {
  const attributes = mergeMarketplaceCategoryAttributes('cars', { [brandAttr]: 'toyota', [modelAttr]: 'camry', color: 'رصاصي' });
  const previous = { category: 'cars', attributes };
  assert.equal(attributes.brand, 'تويوتا');
  assert.equal(attributes.model, 'كامري');
  assert.equal(getListingCarModel(previous)?.id, 'camry');
  assert.deepEqual(mergeMarketplaceCategoryAttributes('cars', { warranty: 'confirmed' }, previous), { ...attributes, warranty: 'confirmed' });
  assert.equal(mergeMarketplaceCategoryAttributes('cars', { [brandAttr]: 'toyota' }, previous)[modelAttr], 'camry');
  for (const updates of [{ [modelAttr]: null }, { [brandAttr]: null }, { [brandAttr]: 'nissan' }, { [modelAttr]: 'other' }]) {
    assert.equal(mergeMarketplaceCategoryAttributes('cars', updates, previous).model, undefined);
  }
  const cleared = mergeMarketplaceCategoryAttributes('mobile_phones', {}, previous);
  assert.equal(cleared[modelAttr], undefined);
  assert.equal(cleared.model, undefined);
  assert.equal(cleared.color, 'رصاصي');
  for (const [category, updates] of [
    ['cars', { [brandAttr]: 'toyota', [modelAttr]: 'patrol' }],
    ['cars', { [modelAttr]: 'camry' }],
    ['mobile_phones', { [brandAttr]: 'apple', [modelAttr]: 'camry' }],
    ['cars', { [brandAttr]: 'other', [modelAttr]: 'camry' }],
  ] as const) assert.throws(() => mergeMarketplaceCategoryAttributes(category, updates), InvalidMarketplaceCategoryOptionError);
  const legacy = { category: 'cars', attributes: { model: 'Seller confirmed vehicle', brand: 'Toyota' } };
  assert.deepEqual(mergeMarketplaceCategoryAttributes('cars', { color: 'أبيض' }, legacy), { ...legacy.attributes, color: 'أبيض' });
  assert.equal(getListingCarModel(legacy), undefined, 'no backfilling legacy free-text values');
});

test('every car choice survives creation, unrelated edits and exact public filtering', () => {
  for (const [brand, choices] of Object.entries(marketplaceCarModelsByBrand)) {
    for (const model of choices) {
      const listing = createListingDraft({ sellerId: `models-${brand}`, category: 'cars', title: 'سيارة تجريبية', attributes: { [brandAttr]: brand, [modelAttr]: model.id } });
      assert.equal(getListingCarModel(listing)?.id, model.id);
      const edited = updateListingForSeller(listing.id, listing.sellerId, { description: 'وصف العميل' })!;
      assert.equal(getListingCarModel(edited)?.id, model.id);
      setListingStatusForSeller(listing.id, listing.sellerId, 'published');
      assert.deepEqual(listPublicMarketplaceListings({ category: 'cars', categoryOption: brand, carModel: model.id }).map(item => item.id), [listing.id]);
      setListingStatusForSeller(listing.id, listing.sellerId, 'deleted');
    }
  }
});

test('public search combines car, brand, title, city and pagination without a model call', async t => {
  for (const [id, model, city] of [['camry-riyadh', 'camry', 'الرياض'], ['camry-jeddah', 'camry', 'جدة'], ['corolla-riyadh', 'corolla', 'الرياض']]) {
    createListingDraft({ id, sellerId: id, category: 'cars', title: 'سيارة للبيع', city, attributes: { [brandAttr]: 'toyota', [modelAttr]: model } });
    setListingStatusForSeller(id, id, 'published');
  }
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Search must not call a model'); });
  const response = await GET(new Request('https://example.test/api/marketplace/listings?category=cars&categoryOption=toyota&carModel=camry&city=' + encodeURIComponent('الرياض') + '&q=' + encodeURIComponent('للبيع') + '&limit=1'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).listings.map((item: { id: string }) => item.id), ['camry-riyadh']);
  for (const query of ['carModel=camry', 'category=cars&carModel=camry', 'category=cars&categoryOption=nissan&carModel=camry', 'category=mobile_phones&categoryOption=apple&carModel=camry']) {
    assert.equal((await GET(new Request('https://example.test/api/marketplace/listings?' + query))).status, 400);
  }
  assert.equal(analyze.mock.callCount(), 0);
  const malicious = "camry' OR TRUE --";
  const sql = Prisma.sql`${publicListingFiltersSql({ category: 'cars', categoryOption: 'toyota', carModel: malicious })}`;
  assert.ok(sql.values.includes(brandAttr));
  assert.ok(sql.values.includes(modelAttr));
  assert.ok(sql.values.includes(malicious));
  assert.ok(!sql.text.includes(malicious));
});

test('seller HTTP writes and Hamad drafts use the same validated car catalog without changing ownership or publishing', async () => {
  const seller = { id: 'car-model-owner', email: 'cars@example.test' };
  const request = (method: string, body: unknown, actor = seller) => new Request('https://example.test/api/marketplace/listings', {
    method, headers: { 'Content-Type': 'application/json', Cookie: createSessionCookie(actor).split(';')[0] }, body: JSON.stringify(body),
  });
  const created = await POST(request('POST', { category: 'cars', title: 'تويوتا كامري', attributes: { [brandAttr]: 'toyota', [modelAttr]: 'camry' } }));
  assert.equal(created.status, 201);
  const { listing } = await created.json();
  const context = { params: Promise.resolve({ listingId: listing.id }) };
  assert.equal((await PATCH(request('PATCH', { attributes: { [modelAttr]: 'patrol' } }), context)).status, 400);
  assert.equal(getListingCarModel(getListing(listing.id)!)?.id, 'camry');
  assert.equal((await PATCH(request('PATCH', { attributes: { [modelAttr]: 'corolla' } }, { id: 'other', email: 'other@example.test' }), context)).status, 404);
  assert.equal((await PATCH(request('PATCH', { attributes: { [modelAttr]: null } }), context)).status, 200);
  assert.equal(getListingCarModel(getListing(listing.id)!), undefined);
  const tools = createMarketplaceTools({ issuedAt: 1, expiresAt: 9999999999, user: seller });
  const create = tools.createListingDraft.execute as unknown as (input: Record<string, unknown>, context: object) => Promise<{ status: string; listing?: { id: string; category: string; attributes: Record<string, unknown> } }>;
  assert.equal((await create({ category: 'cars', categoryOption: 'toyota', carModel: 'patrol', title: 'سيارة' }, {})).status, 'invalid_category_option');
  const saved = await create({ category: 'cars', categoryOption: 'nissan', carModel: 'patrol', title: 'نيسان باترول' }, {});
  assert.equal(saved.status, 'draft_created');
  assert.equal(getListingCarModel(saved.listing!)?.id, 'patrol');
  assert.equal(getListing(saved.listing!.id)?.status, 'draft');
  const edit = tools.updateListing.execute as unknown as (input: Record<string, unknown>, context: object) => Promise<{ status: string; listing?: { category: string; attributes: Record<string, unknown> } }>;
  const changed = await edit({ listingId: saved.listing!.id, carModel: 'sunny' }, {});
  assert.equal(changed.status, 'updated');
  assert.equal(getListingCarModel(changed.listing!)?.id, 'sunny');
  assert.ok(!('publishListing' in tools));
  assert.ok(!('searchMarketplaceListings' in tools));
});

test('classification returns only a car model belonging to the suggested brand, without guessing absent choices', async t => {
  const parse = (category: string, categoryOption?: string, carModel?: string) => parseListingCategoryModelOutput(JSON.stringify({ category, categoryOption, carModel, confidence: 0.96 }));
  assert.deepEqual(parse('cars', 'toyota', 'camry'), { category: 'cars', categoryOption: 'toyota', carModel: 'camry', status: 'suggested' });
  assert.deepEqual(parse('cars', 'nissan', 'camry'), { category: 'cars', categoryOption: 'nissan', status: 'suggested' });
  assert.deepEqual(parse('cars', undefined, 'camry'), { category: 'cars', status: 'suggested' });
  assert.deepEqual(parse('mobile_phones', 'apple', 'camry'), { category: 'mobile_phones', categoryOption: 'apple', status: 'suggested' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => textAnalysis({ category: 'cars', categoryOption: 'nissan', carModel: 'patrol' }));
  assert.deepEqual(await createListingCategoryClassifier().suggest({ title: 'سيارة', description: 'نيسان باترول' }), { category: 'cars', categoryOption: 'nissan', carModel: 'patrol', status: 'suggested' });
});

test('admin filters combine brand and model before pagination and reject mismatches before database reads', async t => {
  const reads: Array<{ where: unknown; skip?: number }> = [];
  const findMany = prisma.listing.findMany;
  const count = prisma.listing.count;
  prisma.listing.findMany = t.mock.fn(async (args: unknown) => { reads.push(args as typeof reads[number]); return []; }) as typeof findMany;
  prisma.listing.count = t.mock.fn(async (args: unknown) => { reads.push(args as typeof reads[number]); return 0; }) as typeof count;
  t.after(() => { prisma.listing.findMany = findMany; prisma.listing.count = count; });
  const headers = { Cookie: createSessionCookie({ id: 'car-catalog-admin', email: 'cars-admin@example.test', role: 'admin' }) };
  const response = await adminGet(new Request('https://example.test/api/admin/listings?category=cars&categoryOption=toyota&carModel=camry&page=2&limit=10', { headers }));
  assert.equal(response.status, 200);
  assert.deepEqual(reads[0].where, { category: 'cars', attributes: { path: [brandAttr], equals: 'toyota' }, AND: [{ attributes: { path: [modelAttr], equals: 'camry' } }] });
  assert.deepEqual(reads[1].where, reads[0].where);
  assert.equal(reads[0].skip, 10);
  assert.equal((await adminGet(new Request('https://example.test/api/admin/listings?category=cars&categoryOption=nissan&carModel=camry', { headers }))).status, 400);
  assert.equal(reads.length, 2);
});

test('admin car edits reject mismatches without modifying records and audit valid model changes', async t => {
  const existing = { id: 'admin-car', sellerId: 'seller', category: 'cars', title: 'سيارة', description: 'وصف السيارة', city: 'الرياض', condition: null, price: 100, priceMode: null, status: 'draft', compliance: {}, createdAt: new Date(), updatedAt: new Date(), attributes: { [brandAttr]: 'toyota', [modelAttr]: 'camry', brand: 'تويوتا', model: 'كامري', color: 'أبيض' } };
  const findUnique = prisma.listing.findUnique;
  const transaction = prisma.$transaction;
  prisma.listing.findUnique = t.mock.fn(async () => existing) as unknown as typeof findUnique;
  t.after(() => { prisma.listing.findUnique = findUnique; prisma.$transaction = transaction; });
  let data: Record<string, unknown> | undefined;
  let audits = 0;
  prisma.$transaction = t.mock.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    listing: { update: async (args: { data: Record<string, unknown> }) => { data = args.data; return { ...existing, ...data }; } },
    adminAuditLog: { create: async () => { audits++; } },
  })) as unknown as typeof transaction;
  const headers = { 'Content-Type': 'application/json', Cookie: createSessionCookie({ id: 'car-write-admin', email: 'cars-write@example.test', role: 'admin' }) };
  const patch = (body: unknown) => adminPatch(new Request('https://example.test/api/admin/listings/admin-car', { method: 'PATCH', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ listingId: existing.id }) });
  assert.equal((await patch({ carModel: 'patrol' })).status, 400);
  assert.equal(data, undefined);
  assert.equal((await patch({ carModel: 'corolla' })).status, 200);
  assert.deepEqual((data as Record<string, unknown> | undefined)?.attributes, { ...existing.attributes, [modelAttr]: 'corolla', model: 'كورولا' });
  assert.equal(audits, 1);
});

test('home browse memory keys include the exact selected car, not just its brand', () => {
  const filters = { searchInput: 'سيارة', categoryGroup: 'سيارات ومركبات', subcategory: 'السيارات', city: 'all', categoryOption: 'toyota' };
  assert.notEqual(getHomeBrowseKey({ ...filters, carModel: 'camry' }), getHomeBrowseKey({ ...filters, carModel: 'corolla' }));
  assert.notEqual(getHomeBrowseKey(filters), getHomeBrowseKey({ ...filters, carModel: 'camry' }));
});
