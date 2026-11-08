import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PATCH as editUser } from '@/app/api/admin/users/[userId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

test('PostgreSQL administrative user audit captures a profile committed after the request snapshot', { timeout: 20_000 }, async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  const suffix = randomUUID();
  const owner = { id: `account-audit-owner-${suffix}`, email: `account-audit-owner-${suffix}@example.test` };
  const customer = { id: `account-audit-customer-${suffix}`, email: `account-audit-customer-${suffix}@example.test` };
  for (const [key, value] of Object.entries({
    SMARTSTORE_ADMIN_EMAILS: owner.email, AUTH_SECRET: 'isolated-postgres-account-audit-only',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  await prisma.user.create({ data: owner });
  await prisma.user.create({ data: { ...customer, phoneNumber: '+966501112233' } });
  t.after(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, customer.id] } } });
  });
  const transaction = prisma.$transaction.bind(prisma);
  let inject = true;
  mockDatabaseMethod(t, prisma, '$transaction', async (callback: never, ...rest: never[]) => {
    if (inject) {
      inject = false;
      // This real committed write finishes after the handler's initial read
      // and before its evidence and User row locks are obtained.
      await prisma.user.update({ where: { id: customer.id }, data: { phoneNumber: '+966502223344', role: 'moderator' } });
    }
    return transaction(callback, ...rest);
  });
  const token = createSignedSession(owner);
  const response = await editUser(new Request('https://example.test/api/admin/users/' + customer.id, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '+966503334455' }),
  }), { params: Promise.resolve({ userId: customer.id }) });
  assert.equal(response.status, 200);
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
  assert.equal(saved.phoneNumber, '+966503334455');
  assert.equal(saved.role, 'moderator');
  const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { adminId: owner.id, targetId: customer.id, action: 'update_user' } });
  const metadata = audit.metadata as { previous: { role: string; phoneNumber: string }; updates: { phoneNumber: string } };
  assert.deepEqual(metadata.previous, { role: 'moderator', phoneNumber: '+966502223344' });
  assert.equal(metadata.updates.phoneNumber, '+966503334455');
});

test.after(async () => { await prisma.$disconnect(); });
