import { createHash, randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

type Kind = 'listing-published' | 'listing-follow' | 'conversation-message';
type Payload = { listingId?: string; userId?: string; messageId?: string; source?: string };
const leaseMs = 120_000;
const maximumAttempts = 8;
let draining: Promise<{ inspected: number; completed: number; retried: number }> | undefined;

/** Called inside the source transaction: a committed action always has a job. */
export async function enqueueNotificationDelivery(
  database: Pick<Prisma.TransactionClient, 'notificationDeliveryJob'>,
  kind: Kind, key: string, payload: Payload,
) {
  const id = createHash('sha256').update(`${kind}:${key}`).digest('hex');
  await database.notificationDeliveryJob.upsert({ where: { id }, update: {},
    create: { id, kind, payload: payload as Prisma.InputJsonObject } });
}

export async function enqueueFollowDeliveries(listingId: string, userIds: string[], source: 'seller' | 'similar') {
  for (let offset = 0; offset < userIds.length; offset += 250) {
    await prisma.notificationDeliveryJob.createMany({ data: [...new Set(userIds.slice(offset, offset + 250))].map(userId => ({
      id: createHash('sha256').update(`listing-follow:${listingId}:${userId}:${source}`).digest('hex'),
      kind: 'listing-follow', payload: { listingId, userId, source },
    })), skipDuplicates: true });
  }
}

export const notificationDeliveryEffects = {
  now: () => Date.now(),
  async deliver(kind: string, value: unknown) {
    const payload = value && typeof value === 'object' ? value as Payload : {};
    const { deliverNotificationJob } = await import('./delivery-dispatch');
    await deliverNotificationJob(kind, payload);
  },
};

/** Lease before provider I/O; a process restart recovers the persisted job. */
export async function drainNotificationDeliveries(limit = 4) {
  if (draining) return draining;
  draining = performDrain(limit).finally(() => { draining = undefined; });
  return draining;
}

async function performDrain(limit: number) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return { inspected: 0, completed: 0, retried: 0 };
  const started = notificationDeliveryEffects.now();
  const due = () => prisma.notificationDeliveryJob.findMany({ where: {
    completedAt: null, failedAt: null, nextAttemptAt: { lte: new Date(notificationDeliveryEffects.now()) },
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date(notificationDeliveryEffects.now()) } }],
  }, orderBy: { nextAttemptAt: 'asc' }, take: Math.min(20, Math.max(1, Math.floor(limit))) });
  const pending = await due();
  const seen = new Set<string>();
  let inspected = 0, completed = 0, retried = 0;
  for (const job of pending) {
    if (notificationDeliveryEffects.now() - started > 20_000 || inspected >= Math.min(20, Math.max(1, Math.floor(limit)))) break;
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    const now = notificationDeliveryEffects.now();
    const leaseToken = randomUUID();
    const claimed = await prisma.notificationDeliveryJob.updateMany({ where: {
      id: job.id, completedAt: null, failedAt: null, nextAttemptAt: { lte: new Date(now) },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date(now) } }],
    }, data: { leaseToken, leaseUntil: new Date(now + leaseMs), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    inspected++;
    try {
      await notificationDeliveryEffects.deliver(job.kind, job.payload);
      const result = await prisma.notificationDeliveryJob.updateMany({ where: { id: job.id, leaseToken, completedAt: null },
        data: { completedAt: new Date(notificationDeliveryEffects.now()), payload: {}, leaseToken: null, leaseUntil: null, lastError: null } });
      completed += result.count;
      // Fan-out can create recipient jobs; process them in this bounded pass.
      if (job === pending[pending.length - 1]) pending.push(...(await due()).filter(next => !seen.has(next.id)));
    } catch {
      // Never log provider errors containing tokens, private content or URLs.
      const exhausted = job.attempts + 1 >= maximumAttempts || now - job.createdAt.getTime() > 24 * 60 * 60_000;
      await prisma.notificationDeliveryJob.updateMany({ where: { id: job.id, leaseToken, completedAt: null }, data: {
        leaseToken: null, leaseUntil: null, lastError: 'notification_delivery_unavailable',
        ...(exhausted ? { failedAt: new Date(now) } : { nextAttemptAt: new Date(now + Math.min(300_000, 10_000 * 2 ** job.attempts)) }),
      } });
      console.warn(`[notification_delivery] outcome=${exhausted ? 'exhausted' : 'retry'}`);
      retried++;
    }
  }
  // Keep receipts long enough for idempotent source retries without retaining payloads.
  await prisma.notificationDeliveryJob.deleteMany({ where: { completedAt: { lt: new Date(started - 30 * 24 * 60 * 60_000) } } });
  return { inspected, completed, retried };
}

let nextDrainAt = 0;
/** Fresh app activity and the protected hourly maintenance route resume due jobs. */
export function scheduleNotificationDelivery(force = false) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database' || (!force && Date.now() < nextDrainAt)) return;
  nextDrainAt = Date.now() + 15_000;
  try { after(async () => { await drainNotificationDeliveries().catch(() => {
    console.warn('[notification_delivery] background=unavailable');
  }); }); } catch { /* Durable rows are retried by the next request or maintenance. */ }
}
