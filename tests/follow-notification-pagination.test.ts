import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { deliverPublishedListingNotifications } from '@/agent/marketplace/repository';
import { deliverNotificationJob } from '@/lib/push/delivery-dispatch';

function fixture(t: TestContext) {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  function replace(target: object, key: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
  }
  const listing = { id: 'published-listing', sellerId: 'seller', category: 'furniture', title: 'oak dining table',
    description: null, price: 100, priceMode: null, condition: 'used', city: 'Riyadh', attributes: {}, status: 'published',
    compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    views: 0, messageCount: 0, favoriteCount: 0, createdAt: new Date(0), updatedAt: new Date(0), images: [] };
  const notificationUsers = new Set<string>(); const jobs = new Set<string>();
  let enqueueFailure = false; let pushRecipientsChecked = 0;
  replace(prisma.listing, 'findUnique', async () => listing);
  replace(prisma.sellerFollow, 'findMany', async () => []);
  replace(prisma.similarListingFollow, 'findMany', async () => []);
  replace(prisma.followNotification, 'createMany', async ({ data }: { data: Array<{ userId: string }> }) => {
    data.forEach(row => notificationUsers.add(row.userId)); return { count: data.length };
  });
  replace(prisma.notificationDeliveryJob, 'createMany', async ({ data, skipDuplicates }: { data: Array<{ id: string }>; skipDuplicates: boolean }) => {
    assert.equal(skipDuplicates, true);
    if (enqueueFailure) { enqueueFailure = false; throw new Error('transient enqueue failure'); }
    data.forEach(row => jobs.add(row.id)); return { count: data.length };
  });
  replace(prisma.user, 'findMany', async () => [{ id: listing.sellerId }, { id: 'recipient' }]);
  replace(prisma.user, 'findUnique', async () => ({ id: listing.sellerId, deletedAt: null }));
  replace(prisma.pushSubscription, 'findMany', async () => { pushRecipientsChecked++; return []; });
  replace(prisma.mobilePushToken, 'findMany', async () => []);
  return { replace, listing, notificationUsers, jobs, failNextEnqueue: () => { enqueueFailure = true; }, pushRecipientsChecked: () => pushRecipientsChecked };
}

type FollowQuery = { where: { id?: { gt: string }; userId?: string; category: string }; take: number; orderBy: { id: string } };

test('publication visits matching similar followers beyond 500 without changing eligibility or duplicating recipients', async t => {
  const state = fixture(t);
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    id: String(index).padStart(5, '0'), userId: 'recipient-' + index,
    listing: { ...state.listing, id: 'reference-' + index, sellerId: 'reference-seller' },
  }));
  rows[500].listing.status = 'paused';
  rows[999].listing.title = 'unrelated bedroom lamp';
  rows[1000].userId = rows[0].userId;
  const cursors: Array<string | undefined> = [];
  state.replace(prisma.similarListingFollow, 'findMany', async (query: FollowQuery) => {
    assert.equal(query.where.category, state.listing.category);
    assert.deepEqual(query.orderBy, { id: 'asc' }); assert.equal(query.take, 500);
    cursors.push(query.where.id?.gt);
    return rows.filter(row => !query.where.id || row.id > query.where.id.gt).slice(0, query.take);
  });
  await deliverPublishedListingNotifications(state.listing.id);
  assert.deepEqual(cursors, [undefined, '00499', '00999']);
  assert.equal(state.notificationUsers.size, 998);
  assert.ok(state.notificationUsers.has('recipient-998'));
  assert.ok(!state.notificationUsers.has('recipient-500'));
  assert.ok(!state.notificationUsers.has('recipient-999'));
  assert.equal(state.jobs.size, state.notificationUsers.size);
});

test('a seller follower enqueue failure rejects the durable parent job, and a retry is idempotent', async t => {
  const state = fixture(t); t.mock.method(console, 'warn', () => {});
  state.replace(prisma.sellerFollow, 'findMany', async () => [{ followerId: 'recipient-one' }, { followerId: 'recipient-two' }]);
  state.failNextEnqueue();
  await assert.rejects(deliverPublishedListingNotifications(state.listing.id), /transient enqueue failure/);
  assert.equal(state.notificationUsers.size, 2); assert.equal(state.jobs.size, 0);
  await deliverPublishedListingNotifications(state.listing.id);
  assert.equal(state.notificationUsers.size, 2); assert.equal(state.jobs.size, 2);
  await deliverPublishedListingNotifications(state.listing.id);
  assert.equal(state.notificationUsers.size, 2); assert.equal(state.jobs.size, 2);
});

test('recipient delivery can find its only eligible similar follow after the first 500 rows', async t => {
  const state = fixture(t);
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: String(index).padStart(5, '0'), userId: 'recipient',
    listing: { ...state.listing, id: 'reference-' + index, title: index === 500 ? state.listing.title : 'unrelated bedroom lamp' },
  }));
  const cursors: Array<string | undefined> = [];
  state.replace(prisma.similarListingFollow, 'findMany', async (query: FollowQuery) => {
    assert.equal(query.where.userId, 'recipient');
    assert.deepEqual(query.orderBy, { id: 'asc' });
    cursors.push(query.where.id?.gt);
    return rows.filter(row => !query.where.id || row.id > query.where.id.gt).slice(0, query.take);
  });
  await deliverNotificationJob('listing-follow', { listingId: state.listing.id, userId: 'recipient', source: 'similar' });
  assert.deepEqual(cursors, [undefined, '00499']);
  assert.equal(state.pushRecipientsChecked(), 1);
});
