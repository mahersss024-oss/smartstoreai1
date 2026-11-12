import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getMarketplaceTitleTerms, marketplaceTitleSearchPredicate, matchesMarketplaceTitle } from '@/lib/marketplace/title-search';
import { similarListingCandidateFilterSql } from '@/agent/marketplace/similarity-candidate-filter';
import { getComparableListings } from '@/agent/marketplace/market-intelligence';
import { getListingSimilarityScore } from '@/agent/marketplace/listing-similarity';
import type { ListingRecord } from '@/agent/marketplace/store';

function requireLocalDatabase() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

test('PostgreSQL indexed title matching preserves normalized literal substring and AND semantics', async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the dedicated disposable local PostgreSQL test database.');
  const titles = [
    null, '', 'ordinary phone', '100%_!\\path', '100aX!\\path', "literal ' OR 1=1 --", 'midwordsubstring',
    '\u0622\u064a\u0640\u0641\u064f\u0648\u0646 \u0661\u0665',
    '\u06a9\u06cc\u0627 \u062c\u062f\u06cc\u062f \u06f2\u06f0\u06f2\u06f5',
    '\uff21\uff30\uff30\uff2c\uff25 \uff11\uff15',
    '\u062c\u0648\u0627\u0644\u200f \u0622\u064a\u0641\u0648\u0646\u200c\u0661\u0665',
    'phone\t15', 'other title ! and _ and %',
  ];
  const queries = ['', '%', '_', '!', '\\', '100%_!\\path', "' OR 1=1 --", 'wordsub', '15 apple',
    '\u0627\u064a\u0641\u0648\u0646 15', '\u06a9\u06cc\u0627 2025', '15 phone', '15 missing'];
  await prisma.$transaction(async db => {
    await db.$executeRaw`CREATE TEMP TABLE "TitleParityFixture" (id integer, title text) ON COMMIT DROP`;
    await db.$executeRaw(Prisma.sql`INSERT INTO "TitleParityFixture" (id, title) VALUES ${Prisma.join(titles.map((title, id) => Prisma.sql`(${id}, ${title})`))}`);
    for (const query of queries) {
      const terms = getMarketplaceTitleTerms(query);
      const rows = await db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id FROM "TitleParityFixture" WHERE ${marketplaceTitleSearchPredicate(terms)} ORDER BY id
      `);
      assert.deepEqual(rows.map(row => row.id), titles.flatMap((title, id) => matchesMarketplaceTitle(title, terms) ? [id] : []), query);
    }
  });
});

test('PostgreSQL canonical branch prefilter preserves exact top20 with missing, sentinel and legacy classifications', async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the dedicated disposable local PostgreSQL test database.');
  const branches: unknown[] = [undefined, null, '', 'other', 'custom', 'unknown', 'toyota', 'ford', 'TOYOTA', ' toyota ', '\uff54\uff4f\uff59\uff4f\uff54\uff41', 'legacy-product', 42, { id: 'ford' }, ['ford']];
  const base: ListingRecord = {
    id: 'reference', sellerId: 'owner', category: 'cars', title: 'family sedan clean', attributes: {},
    status: 'published', images: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    views: 0, messageCount: 0, favoriteCount: 0,
    compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
  };
  const candidates = Array.from({ length: 150 }, (_, id) => ({
    ...base, id: `candidate-${String(id).padStart(3, '0')}`,
    updatedAt: id % 2 ? base.updatedAt : '2026-10-02T00:00:00.000Z',
    attributes: branches[id % branches.length] === undefined ? {} : { marketplaceCategoryOption: branches[id % branches.length] },
  }));
  await prisma.$transaction(async db => {
    await db.$executeRaw`CREATE TEMP TABLE "SimilarityPrefilterFixture" (id text, attributes jsonb NOT NULL) ON COMMIT DROP`;
    await db.$executeRaw(Prisma.sql`INSERT INTO "SimilarityPrefilterFixture" (id, attributes) VALUES ${Prisma.join(candidates.map(row => Prisma.sql`(${row.id}, ${JSON.stringify(row.attributes)}::jsonb)`))}`);
    for (const branch of branches) {
      const target = { ...base, attributes: branch === undefined ? {} : { marketplaceCategoryOption: branch } };
      const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "SimilarityPrefilterFixture" WHERE ${similarListingCandidateFilterSql(target)}
      `);
      const eligible = new Set(rows.map(row => row.id));
      const retained = candidates.filter(row => eligible.has(row.id));
      for (const row of candidates.filter(row => !eligible.has(row.id))) assert.equal(getListingSimilarityScore(target, row), 0);
      assert.deepEqual(getComparableListings(target, retained).slice(0, 20).map(row => row.id),
        getComparableListings(target, candidates).slice(0, 20).map(row => row.id), JSON.stringify(branch));
      if (branch === 'toyota') assert.ok(rows.length < candidates.length, 'known conflicts should be removed before transfer/scoring');
    }
  });
});

type Explain = { 'QUERY PLAN': Array<{ Plan: Record<string, unknown>; 'Execution Time': number }> };

test('PostgreSQL plans use title trigrams for generic prepared search and the published category ID keyset index', { timeout: 30_000 }, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the dedicated disposable local PostgreSQL test database.');
  await prisma.$transaction(async db => {
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('Listing_published_title_trgm_idx', 'Listing_published_category_id_idx')
    `;
    assert.equal(indexes.length, 2, 'apply the matching production migration before these checks');
    await db.$executeRaw`CREATE TEMP TABLE "SearchPlanFixture" (id text NOT NULL, title text, status text, category text) ON COMMIT DROP`;
    await db.$executeRaw`
      INSERT INTO "SearchPlanFixture" (id, title, status, category)
      SELECT lpad(i::text, 6, '0'), CASE WHEN i = 12345 THEN 'rareproductneedle' ELSE md5(i::text) END,
        'published', CASE WHEN i % 2 = 0 THEN 'cars' ELSE 'furniture' END
      FROM generate_series(1, 20000) AS i
    `;
    await db.$executeRaw`ANALYZE "SearchPlanFixture"`;
    const before = await db.$queryRaw<Explain[]>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "SearchPlanFixture"
      WHERE status = 'published' AND strpos(public.marketplace_normalized_title(title), 'rareproductneedle') > 0
    `;
    await db.$executeRaw`CREATE INDEX "SearchPlanFixture_title_trgm_idx" ON "SearchPlanFixture" USING GIN (public.marketplace_normalized_title(title) gin_trgm_ops) WHERE status = 'published'`;
    await db.$executeRaw`CREATE INDEX "SearchPlanFixture_category_id_idx" ON "SearchPlanFixture" (category, id) WHERE status = 'published'`;
    await db.$executeRaw`ANALYZE "SearchPlanFixture"`;
    await db.$executeRaw`SET LOCAL plan_cache_mode = force_generic_plan`;
    await db.$executeRaw`PREPARE literal_title_index_plan(text) AS SELECT id FROM "SearchPlanFixture" WHERE status = 'published' AND public.marketplace_normalized_title(title) LIKE $1 ESCAPE '!'`;
    let after: Explain[];
    try {
      after = await db.$queryRaw<Explain[]>`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE literal_title_index_plan('%rareproductneedle%')`;
    } finally {
      await db.$executeRaw`DEALLOCATE literal_title_index_plan`;
    }
    const keyset = await db.$queryRaw<Explain[]>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "SearchPlanFixture"
      WHERE status = 'published' AND category = 'cars' AND id > '010000' ORDER BY id ASC LIMIT 512
    `;
    assert.ok(JSON.stringify(after).includes('SearchPlanFixture_title_trgm_idx'));
    assert.ok(JSON.stringify(keyset).includes('SearchPlanFixture_category_id_idx'));
    t.diagnostic(JSON.stringify({ fixtureRows: 20000, titleBeforeMs: before[0]['QUERY PLAN'][0]['Execution Time'],
      titleAfterMs: after[0]['QUERY PLAN'][0]['Execution Time'], keysetMs: keyset[0]['QUERY PLAN'][0]['Execution Time'],
      titleBeforePlan: before[0]['QUERY PLAN'][0].Plan, titleAfterPlan: after[0]['QUERY PLAN'][0].Plan, keysetPlan: keyset[0]['QUERY PLAN'][0].Plan }));
  }, { timeout: 25_000 });
});
