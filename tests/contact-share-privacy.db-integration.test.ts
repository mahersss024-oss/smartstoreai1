import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';

function localDatabaseEnabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1', 'Only the disposable loopback PostgreSQL database is permitted.');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

let disconnect: (() => Promise<void>) | undefined;
test.after(async () => { await disconnect?.(); });

async function fixture(t: TestContext) {
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const { GET } = await import('@/app/api/marketplace/conversations/[conversationId]/route');
  const { createSignedSession } = await import('@/lib/auth/session');
  disconnect = () => prisma.$disconnect();
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'isolated-contact-share-privacy-session-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request in contact privacy fixture'); });
  const suffix = randomUUID();
  const seller = { id: `privacy-seller-${suffix}`, email: `privacy-seller-${suffix}@example.test`, phoneNumber: '0501234567' };
  const buyer = { id: `privacy-buyer-${suffix}`, email: `privacy-buyer-${suffix}@example.test` };
  const outsider = { id: `privacy-outsider-${suffix}`, email: `privacy-outsider-${suffix}@example.test` };
  const userIds = [seller.id, buyer.id, outsider.id];
  const created = { listingId: undefined as string | undefined };
  t.after(async () => {
    if (created.listingId) await prisma.listing.deleteMany({ where: { id: created.listingId, sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  await prisma.user.createMany({ data: [seller, buyer, outsider] });
  const listing = await prisma.listing.create({ data: {
    sellerId: seller.id, category: 'other', title: `Contact privacy ${suffix}`, status: 'published',
  } });
  created.listingId = listing.id;
  const conversation = await prisma.conversation.create({ data: {
    listingId: listing.id, sellerId: seller.id, buyerId: buyer.id,
  } });
  const readAs = async (actor: typeof buyer) => {
    const response = await GET(new Request('http://localhost/api/marketplace/conversations/' + conversation.id, {
      headers: { Authorization: `Bearer ${createSignedSession(actor)}` },
    }), { params: Promise.resolve({ conversationId: conversation.id }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    return await response.json() as { conversation: { messages: Array<{ id: string; type: string; body: string; metadata: Record<string, unknown> }> } };
  };
  const share = async () => {
    const result = await repository.shareSellerContact(conversation.id, seller.id);
    assert.equal(result.status, 'shared');
    assert.ok(result.message);
    assert.equal(result.message.metadata?.phoneNumber, seller.phoneNumber);
    return result.message;
  };
  return { prisma, repository, seller, buyer, outsider, conversation, share, readAs };
}

test('PostgreSQL delete for everyone removes a newly shared number while retaining read and delivery receipts', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the explicitly enabled disposable local PostgreSQL database.');
  const f = await fixture(t);
  const message = await f.share();
  const beforeRead = await f.readAs(f.buyer);
  assert.equal(beforeRead.conversation.messages.find(item => item.id === message.id)?.metadata.phoneNumber, f.seller.phoneNumber);
  const before = await f.prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
  const beforeMetadata = before.metadata as Record<string, unknown>;
  assert.equal(typeof (beforeMetadata.readBy as Record<string, unknown>)[f.buyer.id], 'string');
  assert.equal(typeof (beforeMetadata.deliveredTo as Record<string, unknown>)[f.buyer.id], 'string');

  const deleted = await f.repository.deleteConversationMessageForUser(f.conversation.id, message.id, f.seller.id, 'for_everyone');
  assert.equal(deleted.status, 'deleted');
  const stored = await f.prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
  const metadata = stored.metadata as Record<string, unknown>;
  assert.equal(stored.type, 'message_deleted');
  assert.equal(stored.body, 'message_deleted');
  assert.equal('phoneNumber' in metadata, false);
  assert.deepEqual(metadata.readBy, beforeMetadata.readBy);
  assert.deepEqual(metadata.deliveredTo, beforeMetadata.deliveredTo);
  assert.equal((metadata.deletedForEveryone as Record<string, unknown>).by, f.seller.id);
  for (const actor of [f.seller, f.buyer]) {
    const result = await f.readAs(actor);
    const dto = result.conversation.messages.find(item => item.id === message.id);
    assert.ok(dto);
    assert.equal(dto.type, 'message_deleted');
    assert.equal('phoneNumber' in dto.metadata, false);
  }
});

test('PostgreSQL only the sender can delete a shared contact for everyone', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the explicitly enabled disposable local PostgreSQL database.');
  const f = await fixture(t);
  const message = await f.share();
  const original = await f.prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
  assert.equal((await f.repository.deleteConversationMessageForUser(f.conversation.id, message.id, f.buyer.id, 'for_everyone')).status, 'not_allowed');
  assert.equal((await f.repository.deleteConversationMessageForUser(f.conversation.id, message.id, f.outsider.id, 'for_everyone')).status, 'not_found');
  const retained = await f.prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
  assert.equal(retained.type, 'contact_share');
  assert.equal(retained.body, original.body);
  assert.deepEqual(retained.metadata, original.metadata);
  assert.equal((await f.readAs(f.buyer)).conversation.messages.find(item => item.id === message.id)?.metadata.phoneNumber, f.seller.phoneNumber);
});

test('PostgreSQL deleting a contact for me leaves it available to the other participant', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the explicitly enabled disposable local PostgreSQL database.');
  const f = await fixture(t);
  const message = await f.share();
  assert.equal((await f.repository.deleteConversationMessageForUser(f.conversation.id, message.id, f.seller.id, 'for_me')).status, 'deleted');
  const stored = await f.prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
  const metadata = stored.metadata as Record<string, unknown>;
  assert.equal(stored.type, 'contact_share');
  assert.equal(metadata.phoneNumber, f.seller.phoneNumber);
  assert.equal(typeof (metadata.deletedFor as Record<string, unknown>)[f.seller.id], 'string');
  const recipient = (await f.readAs(f.buyer)).conversation.messages.find(item => item.id === message.id);
  assert.equal(recipient?.type, 'contact_share');
  assert.equal(recipient?.metadata.phoneNumber, f.seller.phoneNumber);
});

test('PostgreSQL historical deleted-contact rows are redacted in API responses without requiring a database rewrite', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Requires the explicitly enabled disposable local PostgreSQL database.');
  const f = await fixture(t);
  const historical = await f.prisma.conversationMessage.create({ data: {
    conversationId: f.conversation.id, senderId: f.seller.id, type: 'message_deleted', body: 'message_deleted',
    metadata: { phoneNumber: f.seller.phoneNumber, readBy: { historical: 'preserved' } },
  } });
  const response = await f.readAs(f.buyer);
  const message = response.conversation.messages.find(item => item.id === historical.id);
  assert.ok(message);
  assert.equal(message.type, 'message_deleted');
  assert.equal('phoneNumber' in message.metadata, false);
  assert.equal((message.metadata.readBy as Record<string, unknown>).historical, 'preserved');
  const retained = await f.prisma.conversationMessage.findUniqueOrThrow({ where: { id: historical.id } });
  assert.equal((retained.metadata as Record<string, unknown>).phoneNumber, f.seller.phoneNumber);
});
