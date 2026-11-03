import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

function localDatabaseEnabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1', 'Only the dedicated local PostgreSQL database is permitted.');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

test('PostgreSQL notification read and deletion actions use the signed account and preserve another account', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the explicitly enabled dedicated local PostgreSQL test database.');
  const { prisma } = await import('@/lib/db/prisma');
  const { PATCH, DELETE } = await import('@/app/api/notifications/route');
  const { createSignedSession } = await import('@/lib/auth/session');
  for (const [key, value] of Object.entries({
    AUTH_SECRET: 'isolated-notification-account-tests-only',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External network prohibited in notification account test'); });

  const suffix = randomUUID();
  const accountA = { id: `notification-a-${suffix}`, email: `notification-a-${suffix}@example.test` };
  const accountB = { id: `notification-b-${suffix}`, email: `notification-b-${suffix}@example.test` };
  const seller = { id: `notification-seller-${suffix}`, email: `notification-seller-${suffix}@example.test` };
  const userIds = [accountA.id, accountB.id, seller.id];
  const listingIds = [`notification-listing-1-${suffix}`, `notification-listing-2-${suffix}`];
  const notificationIds = [`notification-a-1-${suffix}`, `notification-a-2-${suffix}`,
    `notification-b-1-${suffix}`, `notification-b-2-${suffix}`];
  const alreadyReadAt = new Date('2026-01-01T00:00:00.000Z');
  const request = (method: string, query: URLSearchParams, body: Record<string, string>) =>
    new Request(`http://localhost/api/notifications?${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${createSignedSession(accountA)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const readAccountB = () => prisma.followNotification.findMany({
    where: { userId: accountB.id }, orderBy: { id: 'asc' },
  });

  try {
    await prisma.user.createMany({ data: [accountA, accountB, seller] });
    await prisma.listing.createMany({ data: listingIds.map(id => ({
      id, sellerId: seller.id, category: 'furniture', title: 'Local notification account fixture', status: 'published',
    })) });
    await prisma.followNotification.createMany({ data: [
      { id: notificationIds[0], userId: accountA.id, listingId: listingIds[0], readAt: null },
      { id: notificationIds[1], userId: accountA.id, listingId: listingIds[1], readAt: alreadyReadAt },
      { id: notificationIds[2], userId: accountB.id, listingId: listingIds[0], readAt: null },
      { id: notificationIds[3], userId: accountB.id, listingId: listingIds[1], readAt: alreadyReadAt },
    ].map(row => ({ ...row, sellerId: seller.id, title: 'Local notification fixture', url: `/listings/${row.listingId}` })) });
    const untouchedB = await readAccountB();

    await t.test('marking read ignores a client-supplied account and preserves existing read timestamps', async () => {
      const response = await PATCH(request('PATCH', new URLSearchParams({ userId: accountB.id }), {
        userId: accountB.id, actorId: accountB.id,
      }));
      assert.equal(response.status, 200);
      const result = await response.json() as { readAt: string };
      const ownUnread = await prisma.followNotification.findUniqueOrThrow({ where: { id: notificationIds[0] } });
      const ownRead = await prisma.followNotification.findUniqueOrThrow({ where: { id: notificationIds[1] } });
      assert.ok(ownUnread.readAt);
      assert.equal(ownUnread.readAt.toISOString(), result.readAt);
      assert.equal(ownRead.readAt?.toISOString(), alreadyReadAt.toISOString());
      assert.deepEqual(await readAccountB(), untouchedB);
    });

    await t.test('deleting another account notification returns not found without deleting either account data', async () => {
      const response = await DELETE(request('DELETE', new URLSearchParams({
        id: notificationIds[2], userId: accountB.id,
      }), { userId: accountB.id, actorId: accountB.id }));
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'notification_not_found' });
      assert.equal(await prisma.followNotification.count({ where: { userId: accountA.id } }), 2);
      assert.deepEqual(await readAccountB(), untouchedB);
    });

    await t.test('deleting an owned notification uses the URL id and authenticated account', async () => {
      const response = await DELETE(request('DELETE', new URLSearchParams({
        id: notificationIds[0], userId: accountB.id,
      }), { id: notificationIds[2], userId: accountB.id, actorId: accountB.id }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { deleted: true });
      assert.equal(await prisma.followNotification.findUnique({ where: { id: notificationIds[0] } }), null);
      assert.equal(await prisma.followNotification.count({ where: { userId: accountA.id } }), 1);
      assert.deepEqual(await readAccountB(), untouchedB);
    });

    await t.test('bulk deletion ignores a supplied foreign identity and clears only the signed account', async () => {
      const response = await DELETE(request('DELETE', new URLSearchParams({ userId: accountB.id }), {
        userId: accountB.id, actorId: accountB.id,
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { deleted: true });
      assert.equal(await prisma.followNotification.count({ where: { userId: accountA.id } }), 0);
      assert.deepEqual(await readAccountB(), untouchedB);
    });
  } finally {
    try {
      await prisma.followNotification.deleteMany({ where: { id: { in: notificationIds }, userId: { in: [accountA.id, accountB.id] } } });
      await prisma.listing.deleteMany({ where: { id: { in: listingIds }, sellerId: seller.id } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }
});
