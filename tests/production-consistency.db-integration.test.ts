import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { POST } from '@/app/api/marketplace/conversations/[conversationId]/route';
import { addConversationMessage, toggleSellerFollow, toggleSimilarListingFollow } from '@/agent/marketplace/repository';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function localDatabaseEnabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

async function fixture(t: TestContext) {
  const suffix = randomUUID();
  for (const [key, value] of Object.entries({
    AUTH_SECRET: 'local-source-consistency-tests-only', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  const seller = await prisma.user.create({ data: { id: `consistency-seller-${suffix}`, email: `consistency-seller-${suffix}@example.test` } });
  const buyer = await prisma.user.create({ data: { id: `consistency-buyer-${suffix}`, email: `consistency-buyer-${suffix}@example.test` } });
  const listing = await prisma.listing.create({ data: {
    sellerId: seller.id, category: 'furniture', title: 'Local wooden desk', description: 'Office desk', status: 'published',
  } });
  const conversation = await prisma.conversation.create({ data: { listingId: listing.id, sellerId: seller.id, buyerId: buyer.id } });
  t.after(async () => {
    const messages = await prisma.conversationMessage.findMany({ where: { conversationId: conversation.id }, select: { id: true } });
    await prisma.notificationDeliveryJob.deleteMany({ where: { id: { in: messages.map(x =>
      createHash('sha256').update('conversation-message:' + x.id).digest('hex')) } } });
    await prisma.apiIdempotencyKey.deleteMany({ where: { actorKey: buyer.id + ':' + conversation.id } });
    await prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer.id] } } });
  });
  return { seller: { id: seller.id, email: seller.email },
    buyer: { id: buyer.id, email: buyer.email }, listing, conversation };
}

test('PostgreSQL send replays a committed source after receipt failure and pruning exactly once', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t), key = 'committed-source-' + randomUUID();
  const writeReceipt = prisma.apiIdempotencyKey.update.bind(prisma.apiIdempotencyKey);
  let fail = true;
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'update', async (...args: Parameters<typeof writeReceipt>) => {
    if (fail) { fail = false; throw new Error('response_receipt_unavailable'); }
    return writeReceipt(...args);
  });
  const send = () => POST(new Request('https://example.test/api/marketplace/conversations/' + f.conversation.id, {
    method: 'POST', headers: { Authorization: `Bearer ${createSignedSession(f.buyer)}`,
      'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ body: 'Local source retry message' }),
  }), { params: Promise.resolve({ conversationId: f.conversation.id }) });
  await assert.rejects(send(), /response_receipt_unavailable/);
  await prisma.apiIdempotencyKey.updateMany({ where: { actorKey: f.buyer.id + ':' + f.conversation.id, key },
    data: { updatedAt: new Date(Date.now() - 121_000) } });
  assert.equal((await send()).status, 201);
  await prisma.apiIdempotencyKey.deleteMany({ where: { actorKey: f.buyer.id + ':' + f.conversation.id, key } });
  assert.equal((await send()).status, 201);
  const messages = await prisma.conversationMessage.findMany({ where: { conversationId: f.conversation.id } });
  assert.equal(messages.length, 1);
  const jobId = createHash('sha256').update('conversation-message:' + messages[0].id).digest('hex');
  assert.equal(await prisma.notificationDeliveryJob.count({ where: { id: jobId } }), 1);
});

test('PostgreSQL concurrent sends with the same source operation persist one message and one delivery job', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, () => addConversationMessage(
    f.conversation.id, f.buyer, 'A concurrent local send', { operationKey: 'shared-source-key' },
  )));
  assert.ok(results.every(x => x.status === 'sent'));
  assert.equal(new Set(results.map(x => x.message?.id)).size, 1);
  assert.equal(await prisma.conversationMessage.count({ where: { conversationId: f.conversation.id } }), 1);
});

for (const kind of ['seller', 'similar'] as const) test(`PostgreSQL ${kind} follow toggles serialize across concurrent requests`, { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => kind === 'seller'
    ? toggleSellerFollow(f.seller.id, f.buyer) : toggleSimilarListingFollow(f.listing.id, f.buyer)));
  assert.equal(results.filter(x => x.status === 'followed').length, 4);
  assert.equal(results.filter(x => x.status === 'unfollowed').length, 4);
  assert.equal(kind === 'seller'
    ? await prisma.sellerFollow.count({ where: { followerId: f.buyer.id, sellerId: f.seller.id } })
    : await prisma.similarListingFollow.count({ where: { userId: f.buyer.id, listingId: f.listing.id } }), 0);
});
