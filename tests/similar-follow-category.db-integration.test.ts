import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('PostgreSQL category corrections retain the existing similar follow and its notification eligibility', async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') { t.skip('Requires the dedicated local PostgreSQL test database.'); return; }
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests are forbidden in this fixture'); });
  const suffix = randomUUID();
  const users = ['reference', 'publisher', 'recipient'].map(role => ({ id: `${role}-${suffix}`, email: `${role}-${suffix}@example.test` }));
  let publishedId: string | undefined;
  try {
    await prisma.user.createMany({ data: users });
    const reference = await prisma.listing.create({ data: {
      sellerId: users[0].id, category: 'cars', title: 'oak dining table', status: 'published',
      compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    } });
    assert.equal((await repository.toggleSimilarListingFollow(reference.id, users[2].id)).status, 'followed');
    const corrected = await repository.updateListingForSeller(reference.id, users[0].id, { category: 'furniture' });
    assert.equal(corrected?.category, 'furniture');
    assert.equal((await prisma.similarListingFollow.findUniqueOrThrow({
      where: { userId_listingId: { userId: users[2].id, listingId: reference.id } },
    })).category, 'cars', 'The durable legacy snapshot deliberately remains unchanged');
    const published = await prisma.listing.create({ data: {
      sellerId: users[1].id, category: 'furniture', title: 'oak dining table', status: 'published',
    } });
    publishedId = published.id;
    await repository.deliverPublishedListingNotifications(published.id);
    assert.equal(await prisma.followNotification.count({ where: { listingId: published.id, userId: users[2].id } }), 1);
    assert.equal(await prisma.notificationDeliveryJob.count({ where: { payload: { path: ['listingId'], equals: published.id } } }), 1);
    await repository.deliverPublishedListingNotifications(published.id);
    assert.equal(await prisma.followNotification.count({ where: { listingId: published.id, userId: users[2].id } }), 1);
    assert.equal((await repository.getSimilarListingFollowState(reference.id, users[2].id)).isFollowing, true);
  } finally {
    if (publishedId) await prisma.notificationDeliveryJob.deleteMany({ where: { payload: { path: ['listingId'], equals: publishedId } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  }
});
