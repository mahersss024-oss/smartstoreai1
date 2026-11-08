import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Prisma } from '@prisma/client';
import { PATCH as editUser } from '@/app/api/admin/users/[userId]/route';
import { PATCH as editCommission } from '@/app/api/admin/commissions/[commissionId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function environment(t: TestContext) {
  for (const [key, value] of Object.entries({
    SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_ADMIN_EMAILS: 'account-commission-owner@example.test',
    AUTH_SECRET: 'isolated-account-commission-mutations', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  mockDatabaseMethod(t, prisma.user, 'upsert', async () => ({ id: 'account-commission-owner' }));
  const token = createSignedSession({ id: 'account-commission-owner', email: 'account-commission-owner@example.test' });
  return (path: string, body: object) => new Request('https://example.test' + path, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function userFixture() {
  return {
    id: 'audit-user', email: 'audit-user@example.test', name: 'Synthetic user', picture: null,
    phoneNumber: '+966501112233', phoneUpdatedAt: new Date(0), role: 'user', deletedAt: null,
    commissionAgreementVersion: null, commissionAgreementAccepted: null,
    createdAt: new Date(0), updatedAt: new Date(0),
    _count: { listings: 0, buyerConversations: 0, sellerConversations: 0, messages: 0, favorites: 0,
      reports: 0, userReportsReceived: 0, commissions: 0, pushSubscriptions: 0 },
  };
}

test('admin user audit records the locked current profile instead of its stale initial snapshot', async t => {
  const request = environment(t);
  let current = userFixture();
  const initialPhone = current.phoneNumber;
  const acceptedPhone = '+966502223344';
  const nextPhone = '+966503334455';
  const locks: string[] = [];
  let rowLocked = false;
  const audits: Array<{ metadata: { previous: { role: string; phoneNumber: string }; updates: { phoneNumber: string } } }> = [];
  mockDatabaseMethod(t, prisma.user, 'findUnique', async () => structuredClone(current));
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    listing: { findMany: async () => [] }, conversation: { findMany: async () => [] },
    $executeRaw: async (sql: TemplateStringsArray) => {
      const query = sql.join('?'); locks.push(query);
      if (query.includes('FOR UPDATE')) {
        // A separate completed profile/role edit occurs after the route read
        // and before its User row lock is granted.
        current = { ...current, phoneNumber: acceptedPhone, role: 'moderator' };
        rowLocked = true;
      }
      return 1;
    },
    user: {
      findUnique: async () => { assert.equal(rowLocked, true); return structuredClone(current); },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        assert.equal(rowLocked, true);
        Object.assign(current, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
        return structuredClone(current);
      },
      findUniqueOrThrow: async () => structuredClone(current),
    },
    adminAuditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return {}; } },
  }));
  const response = await editUser(request('/api/admin/users/' + current.id, { phoneNumber: nextPhone }), {
    params: Promise.resolve({ userId: current.id }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(audits[0].metadata.previous, { role: 'moderator', phoneNumber: acceptedPhone });
  assert.notEqual(audits[0].metadata.previous.phoneNumber, initialPhone);
  assert.equal(audits[0].metadata.updates.phoneNumber, nextPhone);
  const saved = (await response.json()).user;
  assert.equal(saved.phoneNumber, nextPhone);
  assert.equal(saved.role, 'moderator', 'a phone edit preserves the current role');
  assert.ok(locks[0].includes('pg_advisory_xact_lock'));
  assert.ok(locks.at(-1)!.includes('FOR UPDATE'));
});

test('admin user update returns missing without writing or auditing when the user disappears before its row lock', async t => {
  const request = environment(t);
  const current = userFixture();
  mockDatabaseMethod(t, prisma.user, 'findUnique', async () => current);
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    listing: { findMany: async () => [] }, conversation: { findMany: async () => [] }, $executeRaw: async () => 1,
    user: { findUnique: async () => null, update: async () => assert.fail('a vanished user must not be written') },
    adminAuditLog: { create: async () => assert.fail('an unperformed edit must not be audited') },
  }));
  const response = await editUser(request('/api/admin/users/' + current.id, { phoneNumber: '+966503334455' }), {
    params: Promise.resolve({ userId: current.id }),
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'user_not_found');
});

function knownError(code: string, message = 'Synthetic isolated database failure') {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
}

for (const stage of ['read', 'update'] as const) {
  test(`admin commission returns 404 only when its target is missing at ${stage}`, async t => {
    const request = environment(t);
    mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
      commission: {
        findUnique: async () => stage === 'read' ? null : { status: 'due' },
        update: async () => { if (stage === 'read') assert.fail('a missing target must not be updated'); throw knownError('P2025'); },
      },
      adminAuditLog: { create: async () => assert.fail('missing commission must not be audited') },
    }));
    const response = await editCommission(request('/api/admin/commissions/missing', { status: 'paid' }), {
      params: Promise.resolve({ commissionId: 'missing' }),
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'commission_not_found');
  });
}

test('existing commission write outages and conflicts return retryable 503 instead of false 404', async t => {
  const request = environment(t);
  t.mock.method(console, 'warn', () => undefined);
  let code = '';
  let reads = 0;
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    commission: { findUnique: async () => { reads++; return { status: 'due' }; },
      update: async () => { throw knownError(code, code === 'P2028' ? 'Synthetic transaction expired after timeout' : undefined); } },
    adminAuditLog: { create: async () => assert.fail('failed update must not be audited') },
  }));
  for (code of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034']) {
    const response = await editCommission(request('/api/admin/commissions/existing', { status: 'paid' }), {
      params: Promise.resolve({ commissionId: 'existing' }),
    });
    assert.equal(response.status, 503, code);
    assert.equal((await response.json()).error, 'commission_update_unavailable');
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    assert.ok(Number(response.headers.get('Retry-After')) > 0);
  }
  assert.equal(reads, 7, 'each failed write follows a successful target read');
});

test('commission connection initialization failure returns unavailable before any transaction', async t => {
  const request = environment(t);
  t.mock.method(console, 'warn', () => undefined);
  mockDatabaseMethod(t, prisma.user, 'upsert', async () => {
    throw new Prisma.PrismaClientInitializationError('Synthetic connection failure', 'test', 'P1001');
  });
  mockDatabaseMethod(t, prisma, '$transaction', async () => assert.fail('connection failed before transaction'));
  const response = await editCommission(request('/api/admin/commissions/existing', { status: 'paid' }), {
    params: Promise.resolve({ commissionId: 'existing' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'commission_update_unavailable');
});

test('unexpected commission write and audit errors are not disguised as missing records', async t => {
  const request = environment(t);
  const writeFailure = new Error('unexpected_application_bug');
  const auditFailure = knownError('P2025');
  const transactionFailure = knownError('P2028', 'Unexpected transaction API misuse');
  let stage: 'write' | 'audit' | 'transaction-api' = 'write';
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    commission: {
      findUnique: async () => ({ status: 'due' }),
      update: async () => {
        if (stage === 'write') throw writeFailure;
        if (stage === 'transaction-api') throw transactionFailure;
        return { id: 'existing', listingId: 'listing', sellerId: 'seller' };
      },
    },
    adminAuditLog: { create: async () => { throw auditFailure; } },
  }));
  const context = { params: Promise.resolve({ commissionId: 'existing' }) };
  await assert.rejects(editCommission(request('/api/admin/commissions/existing', { status: 'paid' }), context), error => error === writeFailure);
  stage = 'audit';
  await assert.rejects(editCommission(request('/api/admin/commissions/existing', { status: 'paid' }), context), error => error === auditFailure);
  stage = 'transaction-api';
  await assert.rejects(editCommission(request('/api/admin/commissions/existing', { status: 'paid' }), context), error => error === transactionFailure);
});

test('successful administrative commission status update retains its response and audit contract', async t => {
  const request = environment(t);
  const audits: Array<{ metadata: { previousStatus: string; nextStatus: string } }> = [];
  let current = { id: 'existing', listingId: 'listing', sellerId: 'seller', productValue: 1000, commissionAmount: 10,
    status: 'due', paidAt: null as Date | null, createdAt: new Date(0), updatedAt: new Date(0), listing: null };
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    commission: {
      findUnique: async () => ({ status: current.status }),
      update: async ({ data }: { data: { status: string; paidAt: Date } }) => { current = { ...current, ...data }; return current; },
    },
    adminAuditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return {}; } },
  }));
  const response = await editCommission(request('/api/admin/commissions/existing', { status: 'paid' }), {
    params: Promise.resolve({ commissionId: 'existing' }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, 'paid');
  assert.equal(payload.commission.commissionAmount, 10);
  assert.equal(payload.commission.productValue, 1000);
  assert.ok(payload.commission.paidAt);
  assert.deepEqual(audits.map(row => row.metadata), [{ previousStatus: 'due', nextStatus: 'paid', sellerId: 'seller', listingId: 'listing' }]);
});
