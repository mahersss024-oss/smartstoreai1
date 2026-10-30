import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/marketplace/listings/[listingId]/route';
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

test('PostgreSQL similar cards rank beyond the first batch and reread only public approved media', { timeout: 30_000 }, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the dedicated disposable local PostgreSQL test database.');
  const prefix = `similar-sql-${randomUUID()}`;
  const ownerId = `${prefix}-owner`;
  const inactiveId = `${prefix}-inactive`;
  const referenceId = `${prefix}-reference`;
  const attributes = { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry' };
  const city = `${prefix}-city`;
  const base = { sellerId: ownerId, category: 'cars', city, status: 'published' as const, description: 'Isolated SQL fixture', price: 10000 };
  const strongerIds = Array.from({ length: 25 }, (_, i) => `${prefix}-2-model-${String(i).padStart(3, '0')}`);
  const excludedIds = ['draft', 'paused', 'sold', 'deleted'].map(status => `${prefix}-3-${status}`);
  const read = (similar = true) => GET(new Request(`https://example.test/api/marketplace/listings/${referenceId}${similar ? '?view=similar' : ''}`), { params: Promise.resolve({ listingId: referenceId }) });
  try {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${ownerId}@example.test` },
      { id: inactiveId, email: `${inactiveId}@example.test`, deletedAt: new Date() },
    ] });
    const rows = [
      { ...base, id: referenceId, title: 'family sedan clean', attributes },
      ...Array.from({ length: 132 }, (_, i) => ({ ...base, id: `${prefix}-1-title-${String(i).padStart(3, '0')}`, title: 'family sedan clean', attributes: {} })),
      ...strongerIds.map(id => ({ ...base, id, title: 'commuter vehicle', attributes })),
      ...(['draft', 'paused', 'sold', 'deleted'] as const).map((status, i) => ({ ...base, id: excludedIds[i], title: 'family sedan clean', attributes, status })),
      { ...base, id: `${prefix}-3-inactive`, sellerId: inactiveId, title: 'family sedan clean', attributes },
      { ...base, id: `${prefix}-3-category`, category: 'other', title: 'family sedan clean', attributes },
      { ...base, id: `${prefix}-3-conflict`, title: 'family sedan clean', attributes: { ...attributes, marketplaceCarModel: 'corolla' } },
    ] satisfies Prisma.ListingCreateManyInput[];
    await prisma.listing.createMany({ data: rows });
    await prisma.listingImage.createMany({ data: [referenceId, ...strongerIds].flatMap(listingId => [
      { id: `${listingId}-primary`, listingId, originalUrl: `https://images.example.test/${listingId}.webp`, displayUrl: `https://images.example.test/${listingId}-display.webp`, thumbnailUrl: `https://images.example.test/${listingId}-thumbnail.webp`, status: 'approved', isPrimary: true, qualityScore: 100, enhancements: [] },
      { id: `${listingId}-secondary`, listingId, originalUrl: `https://images.example.test/${listingId}-secondary.webp`, displayUrl: `https://images.example.test/${listingId}-secondary.webp`, thumbnailUrl: `https://images.example.test/${listingId}-secondary.webp`, status: 'approved', isPrimary: false, qualityScore: 100, enhancements: [] },
      { id: `${listingId}-pending`, listingId, originalUrl: `https://images.example.test/${listingId}-pending.webp`, displayUrl: `https://images.example.test/${listingId}-pending.webp`, thumbnailUrl: `https://images.example.test/${listingId}-pending.webp`, status: 'pending_review', isPrimary: false, qualityScore: 100, enhancements: [] },
    ]) });

    const response = await read();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    const { listings } = await response.json() as { listings: ListingRecord[] };
    assert.equal(listings.length, 20);
    assert.equal(new Set(listings.map(row => row.id)).size, 20);
    for (const row of listings) {
      assert.ok(strongerIds.includes(row.id), row.id);
      assert.equal(row.status, 'published');
      assert.equal(row.images.length, 1);
      assert.equal(row.images[0].status, 'approved');
      assert.equal(row.images[0].isPrimary, true);
    }
    const detail = await (await read(false)).json();
    assert.equal(detail.listing.id, referenceId);
    assert.equal(detail.listing.images.length, 2);
    assert.equal(detail.listings, undefined);

    const removedId = listings[0].id;
    await prisma.listing.update({ where: { id: removedId }, data: { status: 'paused' } });
    const refreshed = await (await read()).json() as { listings: ListingRecord[] };
    assert.equal(refreshed.listings.length, 20);
    assert.ok(refreshed.listings.every(row => strongerIds.includes(row.id) && row.id !== removedId));
    await prisma.listing.update({ where: { id: referenceId }, data: { status: 'paused' } });
    assert.equal((await read()).status, 404);
  } finally {
    // Fail-closed connection checks above and UUID identities bound cleanup to these local fixtures.
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, inactiveId] } } });
  }
});
