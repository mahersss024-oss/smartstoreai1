import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PATCH } from '@/app/api/admin/listings/[listingId]/route';
import { createSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { activeStaffAccount, staffAccountQuery } from './helpers/staff-fixture';
import { drainNotificationDeliveries, notificationDeliveryEffects } from '@/lib/push/delivery-jobs';

function replaceMethod(t: TestContext, target: object, key: string, method: (...args: never[]) => unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: method });
  t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
}

type Job = {
  id: string; kind: string; payload: object; attempts: number; nextAttemptAt: Date;
  createdAt: Date; completedAt: Date | null; failedAt: Date | null;
  leaseToken: string | null; leaseUntil: Date | null; lastError: string | null;
};

function fixture(t: TestContext, status = 'pending') {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request in notification fixture'); });
  const env = {
    SMARTSTORE_MARKETPLACE_STORE: 'database', DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:9/unused', SMARTSTORE_ADMIN_EMAILS: 'notification-owner@example.test',
    AUTH_SECRET: 'isolated-admin-notification-session-secret',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  replaceMethod(t, prisma.user, 'findUnique', async () => ({ ...activeStaffAccount }));
  let clock = Date.now();
  let listing = {
    id: 'admin-notification-listing', sellerId: 'admin-notification-seller', category: 'furniture',
    title: 'Dining table', description: 'Wooden dining table', city: null, condition: 'used',
    attributes: {}, compliance: { decision: 'allow' }, status, price: null, priceMode: null,
    createdAt: new Date(clock), updatedAt: new Date(clock), firstPublishedAt: null as Date | null,
  };
  let jobs: Job[] = [];
  let failEnqueue = false;
  let sales = 0;
  replaceMethod(t, prisma.listing, 'findUnique', async () => ({ ...listing }));
  replaceMethod(t, prisma, '$transaction', async callback => {
    const next = { ...listing };
    const pendingJobs = jobs.map(job => ({ ...job }));
    const result = await (callback as unknown as (tx: object) => Promise<unknown>)({
      $queryRaw: staffAccountQuery('notification-owner'),
      $executeRaw: async () => 1,
      listing: {
        findUnique: async () => ({ ...next }),
        updateMany: async () => { if (!next.firstPublishedAt) next.firstPublishedAt = new Date(clock); return { count: 1 }; },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(next, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
          return { ...next };
        },
      },
      notificationDeliveryJob: {
        upsert: async ({ create }: { create: { id: string; kind: string; payload: object } }) => {
          if (failEnqueue) throw new Error('isolated_outbox_failure');
          if (!pendingJobs.some(job => job.id === create.id)) pendingJobs.push({
            ...create, attempts: 0, nextAttemptAt: new Date(clock), createdAt: new Date(clock),
            completedAt: null, failedAt: null, leaseToken: null, leaseUntil: null, lastError: null,
          });
          return {};
        },
      },
      adminAuditLog: { create: async () => ({}) },
      commission: { upsert: async () => { sales++; return {}; } },
    });
    listing = next;
    jobs = pendingJobs;
    return result;
  });
  const cookie = createSessionCookie({ id: 'notification-owner', email: 'notification-owner@example.test', role: 'admin' }).split(';')[0];
  const patch = (body: object) => PATCH(new Request('http://localhost/api/admin/listings/' + listing.id, {
    method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ listingId: listing.id }) });
  return {
    patch, get listing() { return listing; }, get jobs() { return jobs; }, get sales() { return sales; },
    failEnqueue() { failEnqueue = true; }, advance(ms: number) { clock += ms; },
    prepareDrain() {
      t.mock.method(notificationDeliveryEffects, 'now', () => clock);
      replaceMethod(t, prisma.notificationDeliveryJob, 'findMany', async () => jobs.filter(job =>
        !job.completedAt && !job.failedAt && job.nextAttemptAt.getTime() <= clock && (!job.leaseUntil || job.leaseUntil.getTime() <= clock)).map(job => ({ ...job })));
      replaceMethod(t, prisma.notificationDeliveryJob, 'updateMany', async args => {
        const { where, data } = args as unknown as { where: { id: string; leaseToken?: string }; data: Record<string, unknown> };
        const job = jobs.find(item => item.id === where.id);
        if (!job || (where.leaseToken && job.leaseToken !== where.leaseToken)) return { count: 0 };
        Object.assign(job, { ...data, attempts: typeof data.attempts === 'object' ? job.attempts + 1 : job.attempts });
        return { count: 1 };
      });
      replaceMethod(t, prisma.notificationDeliveryJob, 'deleteMany', async () => ({ count: 0 }));
    },
  };
}

test('administrative publication atomically records the shared seller/similar notification job', async t => {
  const f = fixture(t);
  const response = await f.patch({ status: 'published' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).listing.status, 'published');
  assert.equal(f.listing.status, 'published');
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0].kind, 'listing-published');
  assert.deepEqual(f.jobs[0].payload, { listingId: f.listing.id });
  assert.ok(f.listing.firstPublishedAt);
});

test('administrative content edits, repeated published status and pausing do not generate publication jobs', async t => {
  const f = fixture(t, 'published');
  for (const update of [{ title: 'Updated dining table' }, { status: 'published' }, { status: 'paused' }]) {
    assert.equal((await f.patch(update)).status, 200);
  }
  assert.equal(f.jobs.length, 0);
  assert.equal(f.listing.title, 'Updated dining table');
  assert.equal(f.listing.status, 'paused');
});

test('an unavailable notification provider cannot lose an administratively committed publication', async t => {
  const f = fixture(t);
  assert.equal((await f.patch({ status: 'published' })).status, 200);
  f.prepareDrain();
  let attempts = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(notificationDeliveryEffects, 'deliver', async (kind: string, payload: unknown) => {
    assert.equal(kind, 'listing-published');
    assert.deepEqual(payload, { listingId: f.listing.id });
    if (++attempts === 1) throw new Error('isolated_provider_unavailable');
  });
  assert.deepEqual(await drainNotificationDeliveries(), { inspected: 1, completed: 0, retried: 1 });
  assert.equal(f.listing.status, 'published');
  assert.equal(f.jobs[0].completedAt, null);
  assert.deepEqual(f.jobs[0].payload, { listingId: f.listing.id });
  f.advance(10_000);
  assert.equal((await drainNotificationDeliveries()).completed, 1);
  assert.equal(attempts, 2);
  assert.ok(f.jobs[0].completedAt);
});

test('publication rolls back when its durable notification job cannot be stored', async t => {
  const f = fixture(t);
  f.failEnqueue();
  await assert.rejects(f.patch({ status: 'published' }), /isolated_outbox_failure/);
  assert.equal(f.listing.status, 'pending');
  assert.equal(f.listing.firstPublishedAt, null);
  assert.equal(f.jobs.length, 0);
});

test('administrative sale keeps commission creation and does not create a publication job', async t => {
  const f = fixture(t, 'published');
  assert.equal((await f.patch({ status: 'sold' })).status, 200);
  assert.equal(f.sales, 1);
  assert.equal(f.listing.status, 'sold');
  assert.equal(f.jobs.length, 0);
});
