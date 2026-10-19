import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { createListingId } from '@/lib/marketplace/listing-id';
import { getMarketplaceListingIdLookup, publicListingFiltersSql } from '@/lib/marketplace/title-search';
import { createListingDraft, setListingStatusForSeller } from '@/agent/marketplace/store';
import { listPublicMarketplaceListings } from '@/agent/marketplace/repository';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/marketplace/listings/route';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

test('ID parsing recognizes full new and historical identifiers without mistaking product titles', () => {
  const id = createListingId('seller', 'search-parser');
  for (const value of [id, id.toUpperCase(), ` \u200f${id}\u200e `, `listing id: ${id}`, `\u0631\u0642\u0645 \u0627\u0644\u0625\u0639\u0644\u0627\u0646: ${id}`,
    `https://example.test/listings/${id}?share=1#details`, `/listings/${id}/`]) {
    assert.equal(getMarketplaceListingIdLookup(value), id);
  }
  for (const value of ['chat-draft-8a09f39320b5', '2db9c9ed-aa35-4af6-a8d3-9a2a02e00eab']) assert.equal(getMarketplaceListingIdLookup(value), value);
  assert.equal(getMarketplaceListingIdLookup('/listings/Legacy-Custom-ID'), 'Legacy-Custom-ID');
  for (const value of ['Adidas', 'adidas shoes', 'iPhone', 'Camry 2020', id.slice(0, -1), `${id}...`,
    'https://example.test/not-listings/desk', '/listings/%ZZ', '/listings/a%2Fb', "' OR 1=1 --", '']) {
    assert.equal(getMarketplaceListingIdLookup(value), null, value);
  }
});

test('ID SQL uses parameterized primary-key equality while retaining every explicit filter', () => {
  const id = createListingId('seller', 'sql-search');
  const sql = Prisma.sql`${publicListingFiltersSql({ query: id, city: 'Riyadh', category: 'cars', categories: ['cars'],
    minPrice: 10, maxPrice: 200, condition: 'used', yearMin: 2020, yearMax: 2025, mileageMin: 0, mileageMax: 1000, excludedTerms: ['damaged'] })}`;
  assert.match(sql.text, /^"id" = \$1 AND/);
  assert.equal(sql.values[0], id);
  assert.ok(!sql.text.includes(id));
  for (const field of ['city', 'category', 'price', 'condition', 'attributes']) assert.ok(sql.text.includes(`"${field}"`));
  assert.ok(sql.text.includes('NOT ('));
  assert.ok(!/ILIKE|LIKE|"id".*contains/.test(sql.text));
  const normal = Prisma.sql`${publicListingFiltersSql({ query: 'Adidas' })}`;
  assert.ok(normal.text.includes('"title"'));
  assert.ok(!normal.text.includes('"id"'));
});

test('real public API finds full IDs and old links without models, ignoring neither filters nor hidden status', async t => {
  mockAllowedTextAnalysis(t);
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  });
  const ids = [createListingId('seller', 'public-api'), 'chat-draft-historical-api', '82021701-6b45-4ac0-a388-226659a54780'];
  for (const id of ids) {
    createListingDraft({ id, sellerId: `seller-${id}`, title: 'Desk for sale', category: 'furniture', city: 'Riyadh', price: 100, condition: 'used' });
    setListingStatusForSeller(id, `seller-${id}`, 'published');
  }
  const draft = createListingDraft({ sellerId: 'hidden-draft', category: 'other', title: 'Private draft' });
  const paused = createListingDraft({ sellerId: 'hidden-paused', category: 'other', title: 'Paused listing' });
  setListingStatusForSeller(paused.id, paused.sellerId, 'paused');
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Search cannot call a model'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('Search cannot read model results'); });
  const search = async (q: string, filters: Record<string, string> = {}) => {
    const response = await GET(new Request(`https://example.test/api/marketplace/listings?${new URLSearchParams({ q, ...filters })}`));
    assert.equal(response.status, 200);
    return response.json() as Promise<{ listings: { id: string }[]; pagination: { hasMore: boolean } }>;
  };
  for (const id of ids) {
    assert.deepEqual((await search(id)).listings.map(item => item.id), [id]);
    assert.deepEqual((await search(`https://example.test/listings/${id}`)).listings.map(item => item.id), [id]);
  }
  assert.equal((await search(ids[0])).pagination.hasMore, false);
  assert.equal((await search(ids[0], { city: 'Jeddah' })).listings.length, 0);
  assert.equal((await search(ids[0], { category: 'cars' })).listings.length, 0);
  assert.equal((await search(ids[0], { categories: 'cars,mobile_phones' })).listings.length, 0);
  assert.equal((await search(ids[0], { minPrice: '101' })).listings.length, 0);
  assert.equal((await search(ids[0], { maxPrice: '99' })).listings.length, 0);
  assert.equal((await search(ids[0], { condition: 'new' })).listings.length, 0);
  for (const id of [draft.id, paused.id, createListingId('missing', 'listing'), `${ids[0]}...`]) assert.deepEqual((await search(id)).listings, []);
  assert.equal((await search('Desk for sale')).listings.length, 3);
  assert.deepEqual((await search('Riyadh')).listings, []);
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(peek.mock.callCount(), 0);
});

test('active database public search wires full IDs to exact SQL before pagination and hydration', async t => {
  const queries: Prisma.Sql[] = [];
  t.mock.method(prisma, '$transaction', async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: async (sql: Prisma.Sql) => { queries.push(sql); return []; },
    listing: { findMany: () => { throw new Error('Empty lookup should not hydrate'); } },
  }));
  t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Search cannot call a model'); });
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  });
  const id = createListingId('seller', 'active-db');
  assert.deepEqual(await listPublicMarketplaceListings({ query: id, city: 'Riyadh', page: 2, limit: 24, take: 25 }), []);
  assert.match(queries[0].text, /"status" = 'published' AND "id" = \$1 AND "city" = \$2/);
  assert.deepEqual(queries[0].values, [id, 'Riyadh', 25, 24]);
  assert.ok(!queries[0].text.includes('"title"'));
});
