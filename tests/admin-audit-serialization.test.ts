import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PATCH as editSiteMessage } from '@/app/api/admin/site-message/route';
import { DELETE as deleteCommission, PATCH as editCommission } from '@/app/api/admin/commissions/[commissionId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function environment(t: TestContext) {
  for (const [key, value] of Object.entries({
    SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_ADMIN_EMAILS: 'serialized-audit-owner@example.test',
    AUTH_SECRET: 'isolated-serialized-administrative-audits', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
    DATABASE_URL: 'postgresql://review:review@127.0.0.1:9/unused',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  mockDatabaseMethod(t, prisma.user, 'upsert', async () => ({ id: 'serialized-audit-owner' }));
  const token = createSignedSession({ id: 'serialized-audit-owner', email: 'serialized-audit-owner@example.test' });
  return (path: string, body: object) => new Request('https://example.test' + path, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const messagePayload = (message: string) => ({ message, type: 'info', isEnabled: true, expiresAt: null });

for (const previouslyExists of [false, true]) {
  test(`site-message audit reads only after its singleton lock, including first creation: ${previouslyExists}`, async t => {
    const request = environment(t);
    const audits: Array<{ metadata: { previous: { message: string } | null; next: { message: string }; operation: string } }> = [];
    let locked = false;
    let current = previouslyExists ? messagePayload('initial snapshot') : null;
    mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: 'ReadCommitted' });
      return work({
        $executeRaw: async (strings: TemplateStringsArray, key: string) => {
          assert.match(strings.join('?'), /pg_advisory_xact_lock\(771209/);
          assert.equal(key, 'primary');
          if (previouslyExists) current = messagePayload('a separately committed change');
          locked = true;
          return 1;
        },
        siteMessage: {
          findUnique: async () => { assert.equal(locked, true); return structuredClone(current); },
          upsert: async ({ create, update }: { create: ReturnType<typeof messagePayload>; update: ReturnType<typeof messagePayload> }) => {
            assert.equal(locked, true); current = current ? update : create; return structuredClone(current);
          },
        },
        adminAuditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return {}; } },
      });
    });
    const response = await editSiteMessage(request('/api/admin/site-message', messagePayload('new message')));
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(audits[0].metadata.previous?.message ?? null, previouslyExists ? 'a separately committed change' : null);
    assert.equal(audits[0].metadata.operation, previouslyExists ? 'site_message_update' : 'site_message_create');
    assert.equal(audits[0].metadata.next.message, 'new message');
  });
}

test('commission status audit reads the locked current status after an intervening decision', async t => {
  const request = environment(t);
  const locks: string[] = [];
  const audits: Array<{ metadata: { previousStatus: string; nextStatus: string } }> = [];
  let locked = false;
  let current = { id: 'commission', listingId: 'listing', sellerId: 'seller', status: 'due',
    productValue: 1000, commissionAmount: 10, paidAt: new Date(0), createdAt: new Date(0), updatedAt: new Date(0), listing: null };
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
    assert.deepEqual(options, { isolationLevel: 'ReadCommitted' });
    return work({
      $executeRaw: async (strings: TemplateStringsArray, key: string) => {
        const sql = strings.join('?'); locks.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) assert.equal(key, 'listing:listing');
        if (sql.includes('FOR UPDATE')) { current = { ...current, status: 'paid' }; locked = true; }
        return 1;
      },
      commission: {
        findUnique: async ({ select }: { select: { listingId?: boolean; status?: boolean } }) => {
          if (select.listingId) return { listingId: current.listingId };
          assert.equal(locked, true); return { status: current.status };
        },
        update: async ({ data }: { data: { status: string } }) => {
          assert.equal(locked, true); current = { ...current, ...data }; return structuredClone(current);
        },
      },
      adminAuditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return {}; } },
    });
  });
  const response = await editCommission(request('/api/admin/commissions/commission', { status: 'waived' }), {
    params: Promise.resolve({ commissionId: 'commission' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commission.status, 'waived');
  assert.equal(audits[0].metadata.previousStatus, 'paid');
  assert.equal(audits[0].metadata.nextStatus, 'waived');
  assert.match(locks[0], /pg_advisory_xact_lock/);
  assert.match(locks[1], /FOR UPDATE/);
});

for (const stillExists of [true, false]) {
  test(`commission deletion shares the evidence lock order and audits only an existing target: ${stillExists}`, async t => {
    const patchRequest = environment(t);
    mockDatabaseMethod(t, prisma.commission, 'findUnique', async () => ({ id: 'commission', listingId: 'listing', sellerId: 'seller' }));
    let locked = false;
    let deletions = 0;
    let audits = 0;
    mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
      $executeRaw: async (strings: TemplateStringsArray, key: string) => {
        assert.match(strings.join('?'), /pg_advisory_xact_lock\(771204/);
        assert.equal(key, 'listing:listing'); locked = true; return 1;
      },
      commission: {
        findUnique: async () => { assert.equal(locked, true); return stillExists ? { id: 'commission' } : null; },
        delete: async () => { assert.equal(locked, true); deletions++; return {}; },
      },
      adminAuditLog: { create: async () => { audits++; return {}; } },
    }));
    const authentication = patchRequest('/api/admin/commissions/commission', {});
    const response = await deleteCommission(new Request(authentication.url, {
      method: 'DELETE', headers: authentication.headers,
    }), { params: Promise.resolve({ commissionId: 'commission' }) });
    assert.equal(response.status, stillExists ? 200 : 404);
    assert.equal(deletions, stillExists ? 1 : 0);
    assert.equal(audits, stillExists ? 1 : 0);
  });
}
