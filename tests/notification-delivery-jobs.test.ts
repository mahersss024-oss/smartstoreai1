import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { drainNotificationDeliveries, enqueueNotificationDelivery, notificationDeliveryEffects } from '@/lib/push/delivery-jobs';
import { deliverNotificationJob } from '@/lib/push/delivery-dispatch';

function replaceMethod(t: TestContext, target: object, key: string, method: (...args: never[]) => unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: method });
  t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
}

function fixture(t: TestContext, attempts = 0) {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  let clock = 1_000_000;
  const job = { id: 'durable-job', kind: 'conversation-message', payload: { messageId: 'message-one' }, attempts,
    nextAttemptAt: new Date(clock), leaseToken: null as string | null, leaseUntil: null as Date | null,
    completedAt: null as Date | null, failedAt: null as Date | null, createdAt: new Date(clock), lastError: null };
  t.mock.method(notificationDeliveryEffects, 'now', () => clock);
  replaceMethod(t, prisma.notificationDeliveryJob, 'findMany', async () => job.completedAt || job.failedAt || job.nextAttemptAt.getTime() > clock || (job.leaseUntil && job.leaseUntil.getTime() > clock) ? [] : [{ ...job }]);
  replaceMethod(t, prisma.notificationDeliveryJob, 'updateMany', async args => {
    const { where, data } = args as unknown as { where: Record<string, unknown>; data: Record<string, unknown> };
    if (where.leaseToken && where.leaseToken !== job.leaseToken) return { count: 0 };
    if (where.OR && (job.completedAt || job.failedAt || (job.leaseUntil && job.leaseUntil.getTime() > clock))) return { count: 0 };
    Object.assign(job, { ...data, attempts: typeof data.attempts === 'object' ? job.attempts + 1 : job.attempts });
    return { count: 1 };
  });
  replaceMethod(t, prisma.notificationDeliveryJob, 'deleteMany', async () => ({ count: 0 }));
  return { job, advance: (ms: number) => { clock += ms; } };
}

test('delivery retries a provider failure without claiming success, and survives a later drain', async t => {
  const f = fixture(t);
  t.mock.method(console, 'warn', () => {});
  let deliveries = 0;
  t.mock.method(notificationDeliveryEffects, 'deliver', async () => { if (++deliveries === 1) throw new Error('provider timeout with private token'); });
  assert.deepEqual(await drainNotificationDeliveries(), { inspected: 1, completed: 0, retried: 1 });
  assert.equal(f.job.completedAt, null); assert.equal(f.job.leaseToken, null);
  assert.equal(f.job.lastError, 'notification_delivery_unavailable');
  assert.deepEqual(await drainNotificationDeliveries(), { inspected: 0, completed: 0, retried: 0 });
  f.advance(10_000);
  assert.deepEqual(await drainNotificationDeliveries(), { inspected: 1, completed: 1, retried: 0 });
  assert.equal(deliveries, 2); assert.deepEqual(f.job.payload, {});
});

test('live leases exclude another worker; expired leases resume after process loss', async t => {
  const f = fixture(t);
  let calls = 0;
  t.mock.method(notificationDeliveryEffects, 'deliver', async () => { calls++; });
  f.job.leaseToken = 'lost-process'; f.job.leaseUntil = new Date(1_030_000);
  assert.equal((await drainNotificationDeliveries()).inspected, 0);
  f.advance(30_001);
  assert.equal((await drainNotificationDeliveries()).completed, 1);
  assert.equal(calls, 1);
});

test('retry exhaustion remains visibly failed and never sends forever', async t => {
  const f = fixture(t, 7);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(notificationDeliveryEffects, 'deliver', async () => { throw new Error('unavailable'); });
  assert.equal((await drainNotificationDeliveries()).retried, 1);
  assert.ok(f.job.failedAt); f.advance(1_000_000);
  assert.equal((await drainNotificationDeliveries()).inspected, 0);
});

test('transactional enqueue uses a stable identifier and never resets existing attempts', async t => {
  const calls: unknown[] = [];
  replaceMethod(t, prisma.notificationDeliveryJob, 'upsert', async input => { calls.push(input); return {} as never; });
  await enqueueNotificationDelivery(prisma, 'conversation-message', 'same-message', { messageId: 'same-message' });
  await enqueueNotificationDelivery(prisma, 'conversation-message', 'same-message', { messageId: 'same-message' });
  const [a, b] = calls as Array<{ where: { id: string }; update: object; create: { payload: object } }>;
  assert.equal(a.where.id, b.where.id); assert.deepEqual(a.update, {});
  assert.deepEqual(a.create.payload, { messageId: 'same-message' });
});

test('deleted source messages discard delayed delivery without provider calls', async t => {
  replaceMethod(t, prisma.conversationMessage, 'findUnique', async () => null);
  await deliverNotificationJob('conversation-message', { messageId: 'deleted-message' });
  await assert.rejects(deliverNotificationJob('unknown-job', {}), /invalid_notification_job/);
});
