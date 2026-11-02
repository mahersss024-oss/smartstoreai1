import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setListingModerationStatus } from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';

function replaceMethod(t: TestContext, target: object, key: string, method: (...args: never[]) => unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: method });
  t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
}

function fixture(t: TestContext, status = 'pending') {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request in moderation fixture'); });
  let listing = {
    id: 'moderation-listing', sellerId: 'moderation-seller', category: 'furniture',
    title: 'Wooden desk', description: 'Wooden desk in good condition', attributes: {}, images: [],
    compliance: { decision: 'allow' } as Record<string, unknown>, status, price: null, priceMode: null,
    createdAt: new Date(0), updatedAt: new Date(0), firstPublicationTracked: true, firstPublishedAt: null as Date | null,
    views: 0, messageCount: 0, favoriteCount: 0,
  };
  let jobs: Array<{ id: string; kind: string; payload: object }> = [];
  let audit: Array<{ action: string; targetId: string; metadata?: Record<string, unknown> }> = [];
  let beforeTransaction: (() => void) | undefined;
  const locks: string[] = [];
  let failEnqueue = false;
  let enqueues = 0;
  replaceMethod(t, prisma.listing, 'findUnique', async () => structuredClone(listing));
  replaceMethod(t, prisma.user, 'upsert', async () => ({ id: 'moderation-admin' }));
  replaceMethod(t, prisma.user, 'update', async () => ({ id: 'moderation-admin' }));
  replaceMethod(t, prisma, '$transaction', async callback => {
    beforeTransaction?.();
    beforeTransaction = undefined;
    const next = structuredClone(listing);
    const nextJobs = jobs.map(job => ({ ...job }));
    const nextAudit = [...audit];
    const result = await (callback as unknown as (tx: object) => Promise<unknown>)({
      $executeRaw: async (sql: TemplateStringsArray) => { locks.push(sql.join('?')); return 1; },
      listing: {
        findUnique: async () => structuredClone(next),
        updateMany: async () => { if (!next.firstPublishedAt) next.firstPublishedAt = new Date(); return { count: 1 }; },
        update: async ({ data }: { data: object }) => Object.assign(next, data),
      },
      adminAuditLog: { create: async ({ data }: { data: { action: string; targetId: string } }) => { nextAudit.push(data); return {}; } },
      notificationDeliveryJob: { upsert: async ({ create }: { create: { id: string; kind: string; payload: object } }) => {
        enqueues++;
        if (failEnqueue) throw new Error('isolated_moderation_outbox_unavailable');
        if (!nextJobs.some(job => job.id === create.id)) nextJobs.push(create);
        return {};
      } },
    });
    listing = next; jobs = nextJobs; audit = nextAudit;
    return result;
  });
  return {
    get listing() { return listing; }, get jobs() { return jobs; }, get audit() { return audit; }, get enqueues() { return enqueues; },
    get locks() { return locks; },
    beforeTransaction(callback: () => void) { beforeTransaction = callback; },
    failEnqueue() { failEnqueue = true; },
    moderate: (next: 'published' | 'rejected' | 'deleted') => setListingModerationStatus(listing.id, next, 'moderation-admin'),
  };
}

test('moderator approval commits publication, audit and the shared notification job together', async t => {
  const f = fixture(t);
  const result = await f.moderate('published');
  assert.equal(result.status, 'published');
  assert.equal(result.listing?.compliance.humanDecision, 'allow');
  assert.ok(f.listing.firstPublishedAt);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0].kind, 'listing-published');
  assert.deepEqual(f.jobs[0].payload, { listingId: f.listing.id });
  assert.equal(f.audit[0].action, 'approve_listing');
  assert.equal(f.audit[0].targetId, f.listing.id);
});

test('moderator approval does not enqueue another notification when already published', async t => {
  const f = fixture(t);
  await f.moderate('published');
  const firstPublishedAt = f.listing.firstPublishedAt;
  await f.moderate('published');
  assert.equal(f.jobs.length, 1);
  assert.equal(f.enqueues, 1);
  assert.equal(f.listing.firstPublishedAt?.getTime(), firstPublishedAt?.getTime());
});

test('rejecting or deleting through moderation never queues publication notifications', async t => {
  const f = fixture(t);
  assert.equal((await f.moderate('rejected')).status, 'rejected');
  assert.equal((await f.moderate('deleted')).status, 'deleted');
  assert.equal(f.jobs.length, 0);
  assert.equal(f.enqueues, 0);
});

test('moderation approval fails closed and rolls back when its durable job cannot be stored', async t => {
  const f = fixture(t);
  f.failEnqueue();
  await assert.rejects(f.moderate('published'), /isolated_moderation_outbox_unavailable/);
  assert.equal(f.listing.status, 'pending');
  assert.equal(f.listing.firstPublishedAt, null);
  assert.equal(f.jobs.length, 0);
  assert.equal(f.audit.length, 0);
});

test('moderation approval uses the locked current state for compliance, audit and publication delivery', async t => {
  const f = fixture(t);
  f.beforeTransaction(() => {
    f.listing.status = 'published';
    f.listing.compliance = { decision: 'needs_review', checkStatus: 'unavailable', reasons: ['newest review'] };
  });
  const result = await f.moderate('published');
  assert.equal(result.status, 'published');
  assert.equal(result.listing?.compliance.checkStatus, 'unavailable');
  assert.deepEqual(result.listing?.compliance.reasons, ['newest review']);
  assert.equal(f.audit[0].metadata?.previousStatus, 'published');
  assert.equal(f.jobs.length, 0);
  assert.equal(f.enqueues, 0);
  assert.match(f.locks.at(-1)!, /FOR UPDATE/);
  assert.ok(f.locks.slice(0, -1).every(sql => /pg_advisory_xact_lock/.test(sql)));
});
