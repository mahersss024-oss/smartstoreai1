import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { addConversationMessage } from '@/agent/marketplace/repository';
import { lockUserEvidenceEntities } from '@/agent/marketplace/evidence';
import { lockActiveProfileUser } from '@/lib/auth/profile-account';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function localDatabaseEnabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

test('PostgreSQL buyer deletion and an in-flight send share evidence locks before either conversation or user rows', { timeout: 30_000 }, async t => {
  if (!localDatabaseEnabled()) return t.skip('Only the disposable loopback PostgreSQL test database is permitted.');
  const suffix = randomUUID();
  const seller = await prisma.user.create({ data: { id: `send-seller-${suffix}`, email: `send-seller-${suffix}@example.test` } });
  const buyer = await prisma.user.create({ data: { id: `send-buyer-${suffix}`, email: `send-buyer-${suffix}@example.test` } });
  const listing = await prisma.listing.create({ data: { sellerId: seller.id, category: 'other', title: 'Local concurrency fixture', status: 'published' } });
  const conversation = await prisma.conversation.create({ data: { sellerId: seller.id, buyerId: buyer.id, listingId: listing.id } });
  const transact = prisma.$transaction.bind(prisma);
  let listingLocked!: () => void;
  let resumeSend!: () => void;
  const listingReady = new Promise<void>(resolve => { listingLocked = resolve; });
  const maySend = new Promise<void>(resolve => { resumeSend = resolve; });
  let paused = false;
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    return transact(async tx => {
      const proxy = new Proxy(tx, { get(target, key, receiver) {
        if (key !== '$executeRaw') return Reflect.get(target, key, receiver);
        return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const result = await tx.$executeRaw(strings, ...values);
          if (!paused && strings.join('?').includes('771204') && values.includes(`listing:${listing.id}`)) {
            paused = true; listingLocked(); await maySend;
          }
          return result;
        };
      } });
      return work(proxy);
    }, { timeout: 15_000 });
  });
  let pendingSend: ReturnType<typeof addConversationMessage> | undefined;
  let deletion: Promise<unknown> | undefined;
  try {
    pendingSend = addConversationMessage(conversation.id, buyer.id, 'Local ordered message');
    await listingReady;
    let deletionPid = 0;
    deletion = transact(async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      deletionPid = pid;
      // Use the same lock helper and row order as account DELETE. This retains
      // the account like a financial/evidence-backed deletion, without network.
      await lockUserEvidenceEntities(tx, buyer.id);
      const current = await lockActiveProfileUser(tx, buyer.id);
      assert.ok(current);
      await tx.user.update({ where: { id: buyer.id }, data: { deletedAt: new Date() } });
      await tx.conversation.updateMany({ where: { buyerId: buyer.id }, data: { status: 'closed' } });
    }, { timeout: 15_000 });
    // Observe PostgreSQL itself waiting for the send's advisory lock, rather
    // than relying on an arbitrary sleep to stage the conflicting operations.
    let observedWait = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (deletionPid) {
        const rows = await prisma.$queryRaw<Array<{ wait: string | null }>>`SELECT wait_event AS wait FROM pg_stat_activity WHERE pid = ${deletionPid}`;
        if (rows[0]?.wait === 'advisory') { observedWait = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observedWait, 'The competing deletion must reach its conflicting advisory lock');
    resumeSend();
    const [sendResult, deleteResult] = await Promise.allSettled([pendingSend, deletion]);
    assert.equal(sendResult.status, 'fulfilled', sendResult.status === 'rejected' ? String(sendResult.reason) : undefined);
    assert.equal(deleteResult.status, 'fulfilled', deleteResult.status === 'rejected' ? String(deleteResult.reason) : undefined);
    if (sendResult.status === 'fulfilled') assert.equal(sendResult.value.status, 'sent');
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status, 'closed');
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).deletedAt);
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId: conversation.id, body: 'Local ordered message' } }), 1);
  } finally {
    resumeSend();
    await Promise.allSettled([pendingSend, deletion].filter(Boolean));
    const messages = await prisma.conversationMessage.findMany({ where: { conversationId: conversation.id }, select: { id: true } });
    await prisma.notificationDeliveryJob.deleteMany({ where: { id: { in: messages.map(message => createHash('sha256').update(`conversation-message:${message.id}`).digest('hex')) } } });
    await prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer.id] } } });
  }
});

test.after(async () => { await prisma.$disconnect(); });
