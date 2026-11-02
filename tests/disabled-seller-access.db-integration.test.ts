import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { GET as publicListingDetail } from '@/app/api/marketplace/listings/[listingId]/route';
import {
  createConversationForListing,
  getListing,
  getPublicSellerProfile,
  listPublicMarketplaceListings,
} from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';

function mockDatabaseMethod(t: TestContext, target: object, name: string, implementation: unknown) {
  // Capture the virtual Prisma method itself. Deleting an override does not
  // reliably restore a delegate method for the next test in the same process.
  const original = Reflect.get(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value: implementation });
  t.after(() => Object.defineProperty(target, name, { configurable: true, writable: true, value: original }));
}

function localDatabaseEnabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

async function fixture() {
  const suffix = randomUUID();
  const seller = await prisma.user.create({ data: {
    id: `disabled-seller-${suffix}`, email: `disabled-seller-${suffix}@example.test`, name: 'Local seller fixture',
  } });
  const buyer = await prisma.user.create({ data: {
    id: `disabled-seller-buyer-${suffix}`, email: `disabled-seller-buyer-${suffix}@example.test`,
  } });
  const title = `seller-access-${suffix}`;
  const listing = await prisma.listing.create({ data: {
    id: `seller-access-listing-${suffix}`, sellerId: seller.id, category: 'other',
    title, description: 'Disposable local account availability fixture', status: 'published',
    attributes: {}, compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
  } });
  const feed = () => listPublicMarketplaceListings({ query: title, sort: 'newest', take: 10 });
  const detail = () => publicListingDetail(
    new Request(`https://souqhamad.test/api/marketplace/listings/${listing.id}`),
    { params: Promise.resolve({ listingId: listing.id }) },
  );
  const create = () => createConversationForListing(listing.id, buyer.id);
  const conversationCount = () => prisma.conversation.count({ where: { listingId: listing.id } });
  const messageCount = async () => (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).messageCount;
  const cleanup = () => prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer.id] } } });
  return { seller, buyer, listing, feed, detail, create, conversationCount, messageCount, cleanup };
}

test('PostgreSQL active sellers retain public browsing and idempotent conversation creation', { timeout: 20_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  try {
    assert.deepEqual((await f.feed()).map(listing => listing.id), [f.listing.id]);
    assert.equal((await getListing(f.listing.id, { publicOnly: true }))?.id, f.listing.id);
    assert.equal((await f.detail()).status, 200);
    assert.equal((await getPublicSellerProfile(f.seller.id))?.id, f.seller.id);

    const created = await f.create();
    assert.equal(created.status, 'created');
    assert.equal(created.conversation?.listingId, f.listing.id);
    assert.equal(await f.conversationCount(), 1);
    assert.equal(await f.messageCount(), 1);
    const existing = await f.create();
    assert.equal(existing.status, 'existing');
    assert.equal(existing.conversation?.id, created.conversation?.id);
    assert.equal(await f.conversationCount(), 1);
    assert.equal(await f.messageCount(), 1);
  } finally { await f.cleanup(); }
});

test('PostgreSQL a soft-disabled seller loses public visibility and new contact while internal records remain available', { timeout: 20_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  try {
    await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
    assert.deepEqual(await f.feed(), []);
    assert.equal(await getListing(f.listing.id, { publicOnly: true }), null);
    assert.equal((await f.detail()).status, 404);
    assert.equal(await getPublicSellerProfile(f.seller.id), null);
    assert.equal((await getListing(f.listing.id))?.status, 'published', 'administration keeps the original record and publication state');

    const result = await f.create();
    assert.equal(result.status, 'not_found');
    assert.equal(result.conversation, null);
    assert.equal(await f.conversationCount(), 0);
    assert.equal(await f.messageCount(), 0);
  } finally { await f.cleanup(); }
});

test('PostgreSQL restoring a seller restores its retained public listings and contact without republishing', { timeout: 20_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  try {
    await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
    assert.equal((await f.create()).status, 'not_found');
    assert.deepEqual(await f.feed(), []);

    await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: null } });
    assert.deepEqual((await f.feed()).map(listing => listing.id), [f.listing.id]);
    assert.equal((await f.detail()).status, 200);
    assert.equal((await getListing(f.listing.id, { publicOnly: true }))?.status, 'published');
    assert.equal((await getPublicSellerProfile(f.seller.id))?.id, f.seller.id);
    assert.equal((await f.create()).status, 'created');
    assert.equal(await f.conversationCount(), 1);
    assert.equal(await f.messageCount(), 1);
  } finally { await f.cleanup(); }
});

test('PostgreSQL an existing conversation does not bypass a disabled seller check', { timeout: 20_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  try {
    assert.equal((await f.create()).status, 'created');
    await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
    const result = await f.create();
    assert.equal(result.status, 'not_found');
    assert.equal(result.conversation, null);
    assert.equal(await f.conversationCount(), 1, 'the retained thread is not duplicated or physically removed');
    assert.equal(await f.messageCount(), 1);
  } finally { await f.cleanup(); }
});

test('PostgreSQL a disabled buyer cannot open a new conversation with an active seller', { timeout: 20_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  try {
    await prisma.user.update({ where: { id: f.buyer.id }, data: { deletedAt: new Date() } });
    const result = await f.create();
    assert.equal(result.status, 'not_found');
    assert.equal(result.conversation, null);
    assert.equal(await f.conversationCount(), 0);
    assert.equal(await f.messageCount(), 0);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: f.buyer.id } })).deletedAt);
  } finally { await f.cleanup(); }
});

test('PostgreSQL disabling a seller after contact preflight prevents the pending conversation from committing', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  const findListing = prisma.listing.findUnique.bind(prisma.listing);
  let entered!: () => void;
  let resume!: () => void;
  const preflightComplete = new Promise<void>(resolve => { entered = resolve; });
  const mayContinue = new Promise<void>(resolve => { resume = resolve; });
  let paused = false;
  mockDatabaseMethod(t, prisma.listing, 'findUnique', async (args: Parameters<typeof findListing>[0]) => {
    const result = await findListing(args);
    if (!paused && args.where.id === f.listing.id) {
      paused = true;
      entered();
      await mayContinue;
    }
    return result;
  });
  let pending: ReturnType<typeof createConversationForListing> | undefined;
  try {
    pending = f.create();
    await preflightComplete;
    await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
    resume();
    const result = await pending;
    assert.equal(result.status, 'not_found');
    assert.equal(result.conversation, null);
    assert.equal(await f.conversationCount(), 0);
    assert.equal(await f.messageCount(), 0);
    assert.deepEqual(await f.feed(), []);
  } finally {
    resume();
    await Promise.allSettled(pending ? [pending] : []);
    await f.cleanup();
  }
});

test('PostgreSQL concurrent first-contact requests recover the single existing conversation without incrementing twice', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const f = await fixture();
  const findExisting = prisma.conversation.findUnique.bind(prisma.conversation);
  let snapshots = 0;
  let resume!: () => void;
  const bothRead = new Promise<void>(resolve => { resume = resolve; });
  mockDatabaseMethod(t, prisma.conversation, 'findUnique', async (args: Parameters<typeof findExisting>[0]) => {
    const result = await findExisting(args);
    if (result === null && snapshots < 2) {
      snapshots++; if (snapshots === 2) resume(); await bothRead;
    }
    return result;
  });
  try {
    const results = await Promise.all([f.create(), f.create()]);
    assert.deepEqual(results.map(result => result.status).sort(), ['created', 'existing']);
    assert.equal(results[0].conversation?.id, results[1].conversation?.id);
    assert.equal(await f.conversationCount(), 1); assert.equal(await f.messageCount(), 1);
  } finally { resume(); await f.cleanup(); }
});

for (const participant of ['seller', 'buyer'] as const) {
  test(`PostgreSQL disabling the ${participant} after an existing-thread read prevents its pending replay`, { timeout: 30_000 }, async t => {
    if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
    const f = await fixture();
    let pending: ReturnType<typeof createConversationForListing> | undefined;
    let resume!: () => void;
    const mayContinue = new Promise<void>(resolve => { resume = resolve; });
    try {
      assert.equal((await f.create()).status, 'created');
      const findExisting = prisma.conversation.findUnique.bind(prisma.conversation);
      let entered!: () => void;
      const captured = new Promise<void>(resolve => { entered = resolve; });
      let paused = false;
      mockDatabaseMethod(t, prisma.conversation, 'findUnique', async (args: Parameters<typeof findExisting>[0]) => {
        const result = await findExisting(args);
        if (!paused && result?.listingId === f.listing.id) { paused = true; entered(); await mayContinue; }
        return result;
      });
      pending = f.create();
      await captured;
      await prisma.user.update({ where: { id: f[participant].id }, data: { deletedAt: new Date() } });
      resume();
      const result = await pending;
      assert.equal(result.status, 'not_found'); assert.equal(result.conversation, null);
      assert.equal(await f.conversationCount(), 1); assert.equal(await f.messageCount(), 1);
    } finally {
      resume(); await Promise.allSettled(pending ? [pending] : []); await f.cleanup();
    }
  });
}

test.after(async () => { await prisma.$disconnect(); });
