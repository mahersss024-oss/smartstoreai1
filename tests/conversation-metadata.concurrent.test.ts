import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteConversationMessageForUser,
  markConversationReadForUser,
  markConversationsDeliveredForUser,
} from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';

// Deterministic Prisma simulation, not a PostgreSQL integration test. This gates
// snapshot reads together and simulates row-atomic SQL merges at write time.
test('concurrent read, delivery and local deletion preserve all message metadata', async t => {
  // Prisma delegates expose methods through a proxy rather than own property
  // descriptors, so replace/restore them directly instead of mock.method().
  const replace = <T extends object, K extends keyof T>(target: T, key: K, implementation: unknown) => {
    const original = target[key];
    target[key] = implementation as T[K];
    t.after(() => { target[key] = original; });
  };
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  const createdAt = new Date('2026-10-24T00:00:00Z');
  let metadata: Record<string, unknown> = { attachment: { checksum: 'preserve-me' } };
  let snapshots = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const message = () => ({ id: 'message', conversationId: 'conversation', senderId: 'seller',
    body: 'hello', status: 'sent', type: 'text', reasons: [], metadata: structuredClone(metadata), createdAt });
  const conversation = () => ({ id: 'conversation', listingId: 'listing', sellerId: 'seller', buyerId: 'buyer',
    status: 'open', messages: [message()], createdAt, updatedAt: createdAt, listing: null });
  const snapshot = async <T>(value: T) => {
    snapshots++;
    if (snapshots === 3) release();
    await gate;
    return value;
  };
  replace(prisma.conversation, 'findFirst', async () => {
    const value = conversation();
    return snapshots < 3 ? snapshot(value) : value;
  });
  replace(prisma.conversation, 'findMany', async () => snapshot([conversation()]));
  replace(prisma.conversationMessage, 'findFirst', async () => snapshot({ ...message(), conversation: conversation() }));
  replace(prisma.conversation, 'update', async () => conversation());
  replace(prisma.conversationMessage, 'update', async ({ data }: { data: { metadata?: Record<string, unknown> } }) => {
    if (data.metadata) metadata = structuredClone(data.metadata);
    return message();
  });
  const atomicWrites: string[] = [];
  replace(prisma, '$executeRaw', async (strings: TemplateStringsArray, ...values: unknown[]) => {
    assert.match(strings.join('?'), /UPDATE "ConversationMessage" AS message/);
    assert.match(strings.join('?'), /FROM "Conversation" AS conversation/);
    const [field, secondField, thirdField, encoded, deleteEveryone, secondFlag, messageId, buyer, seller, authFlag, actor] = values;
    assert.equal(field, secondField); assert.equal(field, thirdField);
    assert.equal(deleteEveryone, false); assert.equal(secondFlag, false); assert.equal(authFlag, false);
    assert.equal(messageId, 'message'); assert.equal(buyer, 'buyer'); assert.equal(seller, 'buyer'); assert.equal(actor, 'buyer');
    const key = String(field);
    const existing = metadata[key];
    metadata = { ...metadata, [key]: {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...JSON.parse(String(encoded)),
    } };
    atomicWrites.push(key);
    return 1;
  });
  replace(prisma, '$transaction', async (updates: Promise<unknown>[]) => Promise.all(updates));

  await Promise.all([
    deleteConversationMessageForUser('conversation', 'message', 'buyer', 'for_me'),
    markConversationReadForUser('conversation', 'buyer'),
    markConversationsDeliveredForUser(['conversation'], 'buyer'),
  ]);
  assert.equal((metadata.attachment as Record<string, unknown>).checksum, 'preserve-me');
  for (const field of ['deletedFor', 'readBy', 'deliveredTo']) {
    assert.equal(typeof (metadata[field] as Record<string, unknown>)?.buyer, 'string', `${field} marker must survive the other writes`);
  }
  assert.deepEqual(atomicWrites.sort(), ['deletedFor', 'deliveredTo', 'readBy']);
});
