import assert from 'node:assert/strict';
import test from 'node:test';

test('local PostgreSQL preserves concurrent message markers and deletion authorization', { timeout: 30_000 }, async t => {
  if (!process.env.DATABASE_URL || process.env.SMARTSTORE_DB_INTEGRATION !== '1') {
    t.skip('Requires the explicitly enabled dedicated local test PostgreSQL database.');
    return;
  }
  // Fail before creating Prisma or fixtures if an inherited URL targets any
  // database other than the documented disposable local test database.
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1', 'Use the dedicated loopback test database');
  assert.equal(database.port, '55432', 'Use the dedicated local PostgreSQL port');
  assert.equal(database.pathname, '/smartstore_codex_test', 'Use the dedicated test database');

  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const suffix = crypto.randomUUID();
  const seller = `metadata-seller-${suffix}`;
  const buyer = `metadata-buyer-${suffix}`;
  const outsider = `metadata-outsider-${suffix}`;
  const users = [seller, buyer, outsider];
  let listingId: string | undefined;
  try {
    await prisma.user.createMany({ data: users.map(id => ({ id, email: `${id}@example.test` })) });
    const listing = await prisma.listing.create({ data: {
      sellerId: seller, category: 'other', title: `Metadata concurrency ${suffix}`, status: 'published',
    } });
    listingId = listing.id;
    const conversation = await prisma.conversation.create({ data: {
      listingId, sellerId: seller, buyerId: buyer,
    } });
    const message = await prisma.conversationMessage.create({ data: {
      conversationId: conversation.id, senderId: seller, body: 'Test fixture',
      metadata: { attachment: { checksum: suffix }, deliveredTo: { retained: 'unchanged' } },
    } });

    // These wrappers perform the REAL Prisma reads, then synchronize their
    // completion so all three operations hold pre-write snapshots. Neither
    // results nor SQL writes are mocked; PostgreSQL executes every mutation.
    const originalFirst = prisma.conversation.findFirst;
    const originalMany = prisma.conversation.findMany;
    const originalMessage = prisma.conversationMessage.findFirst;
    const restore = () => {
      prisma.conversation.findFirst = originalFirst;
      prisma.conversation.findMany = originalMany;
      prisma.conversationMessage.findFirst = originalMessage;
    };
    t.after(restore);
    let captures = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const synchronize = async <T>(value: T) => {
      if (captures < 3) {
        captures++;
        if (captures === 3) release();
        await barrier;
      }
      return value;
    };
    prisma.conversation.findFirst =
      (async (...args: Parameters<typeof originalFirst>) => synchronize(await originalFirst(...args))) as unknown as typeof prisma.conversation.findFirst;
    prisma.conversation.findMany =
      (async (...args: Parameters<typeof originalMany>) => synchronize(await originalMany(...args))) as unknown as typeof prisma.conversation.findMany;
    prisma.conversationMessage.findFirst =
      (async (...args: Parameters<typeof originalMessage>) => synchronize(await originalMessage(...args))) as unknown as typeof prisma.conversationMessage.findFirst;

    await Promise.all([
      repository.deleteConversationMessageForUser(conversation.id, message.id, buyer, 'for_me'),
      repository.markConversationReadForUser(conversation.id, buyer),
      repository.markConversationsDeliveredForUser([conversation.id], buyer),
    ]);
    restore();
    assert.equal(captures, 3);
    const afterConcurrent = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
    const metadata = afterConcurrent.metadata as Record<string, unknown>;
    assert.deepEqual(metadata.attachment, { checksum: suffix });
    assert.equal((metadata.deliveredTo as Record<string, unknown>).retained, 'unchanged');
    for (const field of ['deletedFor', 'readBy', 'deliveredTo']) {
      assert.equal(typeof (metadata[field] as Record<string, unknown>)?.[buyer], 'string', `${field} marker must survive concurrent SQL writes`);
    }

    assert.equal((await repository.markConversationReadForUser(conversation.id, outsider)).status, 'not_found');
    assert.equal((await repository.markConversationsDeliveredForUser([conversation.id], outsider)).updatedCount, 0);
    assert.equal((await repository.deleteConversationMessageForUser(conversation.id, message.id, outsider, 'for_me')).status, 'not_found');
    assert.equal((await repository.deleteConversationMessageForUser(conversation.id, message.id, buyer, 'for_everyone')).status, 'not_allowed');
    const afterForbidden = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
    assert.deepEqual(afterForbidden.metadata, afterConcurrent.metadata);
    assert.equal(afterForbidden.body, 'Test fixture');
    assert.equal(afterForbidden.type, 'text');

    assert.equal((await repository.deleteConversationMessageForUser(conversation.id, message.id, seller, 'for_everyone')).status, 'deleted');
    const afterDelete = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: message.id } });
    assert.equal(afterDelete.body, 'message_deleted');
    assert.equal(afterDelete.type, 'message_deleted');
    const deletedMetadata = afterDelete.metadata as Record<string, unknown>;
    assert.deepEqual(deletedMetadata.attachment, metadata.attachment);
    assert.deepEqual(deletedMetadata.deletedFor, metadata.deletedFor);
    assert.deepEqual(deletedMetadata.readBy, metadata.readBy);
    assert.deepEqual(deletedMetadata.deliveredTo, metadata.deliveredTo);
    assert.equal((deletedMetadata.deletedForEveryone as Record<string, unknown>).by, seller);
    assert.equal(typeof (deletedMetadata.deletedForEveryone as Record<string, unknown>).at, 'string');
  } finally {
    // Only this test's uniquely identified listing/users are removed. Listing
    // deletion cascades to its conversation and message fixtures.
    try {
      if (listingId) await prisma.listing.deleteMany({ where: { id: listingId, sellerId: seller } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    } finally {
      await prisma.$disconnect();
      if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
      else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    }
  }
});
