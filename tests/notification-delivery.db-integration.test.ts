import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { enqueueNotificationDelivery, drainNotificationDeliveries, notificationDeliveryEffects } from '@/lib/push/delivery-jobs';

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled = process.env.SMARTSTORE_DB_INTEGRATION === '1' && databaseUrl?.hostname === '127.0.0.1' &&
  databaseUrl.port === '55432' && databaseUrl.pathname === '/smartstore_codex_test';

test('local database delivery jobs roll back with source writes, deduplicate and recover after failure', { skip: !enabled }, async t => {
  const marker = randomUUID();
  const key = `outbox-${marker}`;
  const before = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const ids: string[] = [];
  t.after(async () => {
    if (ids.length) await prisma.notificationDeliveryJob.deleteMany({ where: { id: { in: ids } } });
    if (before === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = before;
    await prisma.$disconnect();
  });
  await assert.rejects(prisma.$transaction(async tx => {
    await enqueueNotificationDelivery(tx, 'conversation-message', key, { messageId: marker });
    throw new Error('source_transaction_rolled_back');
  }), /source_transaction_rolled_back/);
  assert.equal(await prisma.notificationDeliveryJob.count({ where: { payload: { path: ['messageId'], equals: marker } } }), 0);
  await Promise.all(Array.from({ length: 4 }, () => enqueueNotificationDelivery(prisma, 'conversation-message', key, { messageId: marker })));
  const jobs = await prisma.notificationDeliveryJob.findMany({ where: { payload: { path: ['messageId'], equals: marker } } });
  ids.push(...jobs.map(job => job.id)); assert.equal(jobs.length, 1);
  // Restrict this drain to the new job; fixture jobs may coexist in the local database.
  const find = prisma.notificationDeliveryJob.findMany;
  const originalDescriptor = Object.getOwnPropertyDescriptor(prisma.notificationDeliveryJob, 'findMany');
  Object.defineProperty(prisma.notificationDeliveryJob, 'findMany', { configurable: true, writable: true,
    value: (args: { where: object }) => find({ ...args, where: { ...args.where, id: { in: ids } } }),
  });
  t.after(() => { if (originalDescriptor) Object.defineProperty(prisma.notificationDeliveryJob, 'findMany', originalDescriptor); else Reflect.deleteProperty(prisma.notificationDeliveryJob, 'findMany'); });
  let deliveries = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(notificationDeliveryEffects, 'deliver', async () => { if (++deliveries === 1) throw new Error('isolated_provider_unavailable'); });
  assert.equal((await drainNotificationDeliveries()).retried, 1);
  const failed = await prisma.notificationDeliveryJob.findUniqueOrThrow({ where: { id: ids[0] } });
  assert.equal(failed.completedAt, null); assert.equal(failed.attempts, 1); assert.equal(failed.leaseToken, null);
  await prisma.notificationDeliveryJob.update({ where: { id: ids[0] }, data: { nextAttemptAt: new Date(0) } });
  assert.equal((await drainNotificationDeliveries()).completed, 1);
  assert.equal(deliveries, 2);
  assert.equal((await prisma.notificationDeliveryJob.findUniqueOrThrow({ where: { id: ids[0] } })).attempts, 2);
});
