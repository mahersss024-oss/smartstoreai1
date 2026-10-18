import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { getMarketplaceTitleTerms, matchesMarketplaceTitle, marketplaceTitleSearchPredicate, normalizeMarketplaceTitle } from '@/lib/marketplace/title-search';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { createListingDraft, listPublicMarketplaceListings, setListingStatusForSeller } from '@/agent/marketplace/store';
import { listPublicMarketplaceListings as listPublicFromRepository } from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/marketplace/listings/route';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

test('title normalization handles Arabic writing, digits, marks and case without synonyms', () => {
  assert.equal(normalizeMarketplaceTitle('آيـفُون ١٥'), 'ايفون 15');
  assert.equal(normalizeMarketplaceTitle('کیا جدید ۲۰۲۵'), 'كيا جديد 2025');
  assert.equal(normalizeMarketplaceTitle('ＡＰＰＬＥ'), 'apple');
  assert.deepEqual(getMarketplaceTitleTerms('  آيفون ١٥ آيفون  '), ['ايفون', '15']);
  assert.ok(matchesMarketplaceTitle('جوال آيفون أبيض ١٥', getMarketplaceTitleTerms('15 ايفون')));
  assert.ok(!matchesMarketplaceTitle('جوال آيفون ١٤', getMarketplaceTitleTerms('ايفون 15')));
  assert.ok(!matchesMarketplaceTitle('وايت', getMarketplaceTitleTerms('صهريج')));
});

test('database predicate searches only title and treats wildcards and SQL as literal parameter values', () => {
  const input = "%' OR 1=1 --";
  const predicate = Prisma.sql`${marketplaceTitleSearchPredicate([input, 'ايفون'])}`;
  assert.ok(predicate.text.includes('"title"'));
  assert.ok(!predicate.text.includes(input));
  assert.ok(predicate.values.includes(input));
  assert.ok(!/description|searchText|category|city|ILIKE|LIKE/.test(predicate.text));
  assert.equal((predicate.text.match(/strpos/g) ?? []).length, 2);
  assert.ok(predicate.text.includes(' AND '));
});

test('public repository and API search titles only and never consult text models', async t => {
  mockAllowedTextAnalysis(t);
  const make = (id: string, title: string, description: string, category = 'other', city = 'الرياض') => {
    const sellerId = `seller-${id}`;
    const listing = createListingDraft({ id, sellerId, category, title, description, city });
    setListingStatusForSeller(id, sellerId, 'published');
    return listing;
  };
  const phone = make('title-phone', 'جوال آيفون ١٥', 'نظيف', 'mobile_phones');
  make('description-phone', 'جوال آخر', 'آيفون ١٥', 'mobile_phones');
  const ac = make('title-ac', 'مكيفات', 'نظيف', 'computers');
  make('title-ac-jeddah', 'مكيفات', '', 'home_appliances', 'جدة');
  make('title-cone-a', 'قمع أول', 'ايفون');
  make('title-cone-b', 'قمع ثان', 'ايفون');
  const hidden = make('title-hidden', 'قمع مخفي', '');
  setListingStatusForSeller(hidden.id, hidden.sellerId, 'paused');
  createListingDraft({ id: 'title-draft', sellerId: 'draft-seller', category: 'other', title: 'قمع مسودة' });
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Public search must not call a model'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('Public search must not read model analysis'); });
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    assert.deepEqual((await listPublicFromRepository({ query: 'ايفون 15', take: 80 })).map(item => item.id), [phone.id]);
    assert.deepEqual(listPublicMarketplaceListings({ query: 'مكيفات', city: 'الرياض' }).map(item => item.id), [ac.id]);
    assert.equal(listPublicMarketplaceListings({ query: 'الرياض' }).length, 0);
    assert.equal(listPublicMarketplaceListings({ query: 'mobile_phones' }).length, 0);
    assert.equal(listPublicMarketplaceListings({ query: 'منتجغيرموجود' }).length, 0);
    assert.equal(listPublicMarketplaceListings({ query: '%' }).length, 0);
    const first = listPublicMarketplaceListings({ query: 'قمع', limit: 1 });
    const second = listPublicMarketplaceListings({ query: 'قمع', limit: 1, page: 2 });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0].id, second[0].id);
    const response = await GET(new Request('https://example.test/api/marketplace/listings?q=' + encodeURIComponent('قمع') + '&limit=1'));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.listings.length, 1);
    assert.equal(payload.pagination.hasMore, true);
    assert.equal(payload.pagination.nextPage, 2);
    const empty = await GET(new Request('https://example.test/api/marketplace/listings?q=' + encodeURIComponent('منتجغيرموجود')));
    assert.deepEqual((await empty.json()).listings, []);
    const feed = await listPublicFromRepository({ query: '  ', take: 80 });
    assert.ok(feed.some(item => item.id === phone.id));
    assert.ok(!feed.some(item => ['title-hidden', 'title-draft'].includes(item.id)));
    assert.equal(analyze.mock.callCount(), 0);
    assert.equal(peek.mock.callCount(), 0);
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database public search selects and paginates title matches before image hydration in one snapshot', async t => {
  const queries: Prisma.Sql[] = [];
  const reads: unknown[] = [];
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = t.mock.fn(async (callback: (db: unknown) => Promise<unknown>) => callback({
    $queryRaw: async (sql: Prisma.Sql) => { queries.push(sql); return []; },
    listing: { findMany: async (options: unknown) => { reads.push(options); return []; } },
  })) as unknown as typeof prisma.$transaction;
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Unexpected model call'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('Unexpected model cache read'); });
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    assert.deepEqual(await listPublicFromRepository({ query: 'آيفون ١٥', city: 'الرياض', page: 2, limit: 24, take: 25 }), []);
    const sql = queries[0];
    assert.ok(sql.text.includes('"status" = \'published\''));
    assert.ok(sql.text.includes('"city" ='));
    assert.ok(sql.text.includes('LIMIT'));
    assert.ok(sql.text.includes('OFFSET'));
    assert.ok(!/description|searchText|category/.test(sql.text));
    assert.ok(sql.values.includes('ايفون'));
    assert.ok(sql.values.includes('15'));
    assert.deepEqual(sql.values.slice(-3), ['الرياض', 25, 24]);
    assert.equal(reads.length, 0);
    assert.equal(analyze.mock.callCount(), 0);
    assert.equal(peek.mock.callCount(), 0);
    await listPublicFromRepository();
    assert.ok(queries[1].text.includes('"firstPublishedAt" DESC NULLS LAST'));
  } finally {
    prisma.$transaction = originalTransaction;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
