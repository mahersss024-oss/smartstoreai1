import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PATCH as editListing } from '@/app/api/admin/listings/[listingId]/route';
import { DELETE as deleteUser } from '@/app/api/admin/users/[userId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function environment(t: TestContext) {
  const values = {
    SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_ADMIN_EMAILS: 'mutation-owner@example.test',
    AUTH_SECRET: 'local-admin-mutation-concurrency-only', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  };
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  const token = createSignedSession({ id: 'mutation-owner', email: 'mutation-owner@example.test', role: 'admin' });
  return (url: string, method: string, body?: object) => new Request('https://example.test' + url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('administrative partial edits merge the locked current attributes and retain a newly committed human block', async t => {
  const request = environment(t);
  let listing = {
    id: 'concurrent-admin-listing', sellerId: 'concurrent-admin-seller', category: 'furniture',
    title: 'Desk before edit', description: 'Desk in good condition', city: null, condition: 'used',
    attributes: { color: 'white' } as Record<string, unknown>,
    compliance: { decision: 'allow' } as Record<string, unknown>,
    status: 'published', price: null, priceMode: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const audits: Array<{ metadata: { previous: { status: string } } }> = [];
  const locks: string[] = [];
  mockDatabaseMethod(t, prisma.listing, 'findUnique', async () => structuredClone(listing));
  mockDatabaseMethod(t, prisma, '$transaction', async (callback: (tx: unknown) => Promise<unknown>) => {
    // Another accepted edit/moderation decision finishes after the route's
    // first read and before it can enter its transaction.
    listing = { ...listing, status: 'paused', attributes: { color: 'blue', material: 'oak' },
      compliance: { decision: 'review', humanDecision: 'block' } };
    return callback({
      $executeRaw: async (sql: TemplateStringsArray) => { locks.push(sql.join('?')); return 1; },
      listing: {
        findUnique: async () => structuredClone(listing),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(listing, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
          return structuredClone(listing);
        },
      },
      adminAuditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return {}; } },
      notificationDeliveryJob: { upsert: async () => { assert.fail('a content edit must not publish'); } },
    });
  });
  const response = await editListing(request('/api/admin/listings/' + listing.id, 'PATCH', { title: 'Edited desk title' }), {
    params: Promise.resolve({ listingId: listing.id }),
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).listing;
  assert.deepEqual(saved.attributes, { color: 'blue', material: 'oak' });
  assert.equal(saved.title, 'Edited desk title');
  assert.equal(saved.status, 'paused');
  assert.equal(saved.compliance.humanDecision, 'block');
  assert.equal(saved.compliance.decision, 'review');
  assert.match(saved.searchText, /blue/);
  assert.match(saved.searchText, /oak/);
  assert.equal(audits[0].metadata.previous.status, 'paused');
  assert.match(locks.at(-1)!, /FOR UPDATE/);
  assert.ok(locks.slice(0, -1).every(sql => /pg_advisory_xact_lock/.test(sql)));
});

test('administrative permanent deletion rejects an account restored after its initial snapshot', async t => {
  const request = environment(t);
  const snapshot = {
    id: 'restored-during-delete', email: 'restored-during-delete@example.test', role: 'user',
    deletedAt: new Date(0), picture: null, phoneNumber: null, listings: [],
  };
  let deletes = 0;
  let audits = 0;
  let rowLocked = false;
  mockDatabaseMethod(t, prisma.user, 'findUnique', async () => ({ ...snapshot }));
  mockDatabaseMethod(t, prisma, '$transaction', async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $executeRaw: async (sql: TemplateStringsArray) => { if (/FOR UPDATE/.test(sql.join('?'))) rowLocked = true; return 1; },
    listing: { findMany: async () => [] },
    conversation: { findMany: async () => [] },
    user: {
      findUnique: async () => { assert.equal(rowLocked, true); return { ...snapshot, deletedAt: null }; },
      delete: async () => { deletes++; return snapshot; },
    },
    adminAuditLog: { create: async () => { audits++; return {}; } },
  }));
  const response = await deleteUser(request('/api/admin/users/' + snapshot.id + '?mode=permanent', 'DELETE'), {
    params: Promise.resolve({ userId: snapshot.id }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'account_must_be_disabled_first');
  assert.equal(deletes, 0);
  assert.equal(audits, 0);
});
