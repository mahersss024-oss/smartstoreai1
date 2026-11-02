import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { PATCH as editListing } from '@/app/api/admin/listings/[listingId]/route';
import { DELETE as deleteUser } from '@/app/api/admin/users/[userId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function permittedDatabase() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

async function fixture(t: TestContext) {
  const suffix = randomUUID();
  const owner = { id: `admin-race-owner-${suffix}`, email: `admin-race-owner-${suffix}@example.test` };
  const seller = { id: `admin-race-seller-${suffix}`, email: `admin-race-seller-${suffix}@example.test` };
  for (const [key, value] of Object.entries({
    SMARTSTORE_ADMIN_EMAILS: owner.email, AUTH_SECRET: 'local-admin-race-postgres-only',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  await prisma.user.create({ data: owner });
  await prisma.user.create({ data: seller });
  const token = createSignedSession(owner);
  const request = (path: string, method: string, body?: object) => new Request('https://example.test' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  t.after(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, seller.id] } } });
  });
  return { owner, seller, request };
}

test('PostgreSQL administrative edits retain a moderation decision and attributes committed after their initial read', { timeout: 20_000 }, async t => {
  if (!permittedDatabase()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const listing = await prisma.listing.create({ data: {
    sellerId: f.seller.id, category: 'furniture', title: 'Desk before edit', description: 'Wooden office desk',
    status: 'published', attributes: { color: 'white' }, compliance: { decision: 'allow' },
  } });
  const transaction = prisma.$transaction.bind(prisma);
  let inject = true;
  mockDatabaseMethod(t, prisma, '$transaction', async (callback: never, ...rest: never[]) => {
    if (inject) {
      inject = false;
      await prisma.listing.update({ where: { id: listing.id }, data: {
        status: 'paused', attributes: { color: 'blue', material: 'oak' },
        compliance: { decision: 'review', humanDecision: 'block' },
      } });
    }
    return transaction(callback, ...rest);
  });
  const response = await editListing(f.request('/api/admin/listings/' + listing.id, 'PATCH', { title: 'Updated desk title' }), {
    params: Promise.resolve({ listingId: listing.id }),
  });
  assert.equal(response.status, 200);
  const saved = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  assert.deepEqual(saved.attributes, { color: 'blue', material: 'oak' });
  assert.deepEqual((saved.compliance as Record<string, unknown>).humanDecision, 'block');
  assert.equal((saved.compliance as Record<string, unknown>).decision, 'review');
  assert.equal(saved.status, 'paused');
  assert.equal(saved.title, 'Updated desk title');
  assert.match(saved.searchText ?? '', /blue/);
  assert.match(saved.searchText ?? '', /oak/);
});

test('PostgreSQL administrative permanent deletion cannot delete an account restored before its locked check', { timeout: 20_000 }, async t => {
  if (!permittedDatabase()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
  const transaction = prisma.$transaction.bind(prisma);
  let inject = true;
  mockDatabaseMethod(t, prisma, '$transaction', async (callback: never, ...rest: never[]) => {
    if (inject) {
      inject = false;
      await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: null } });
    }
    return transaction(callback, ...rest);
  });
  const response = await deleteUser(f.request('/api/admin/users/' + f.seller.id + '?mode=permanent', 'DELETE'), {
    params: Promise.resolve({ userId: f.seller.id }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'account_must_be_disabled_first');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.seller.id } })).deletedAt, null);
  assert.equal(await prisma.adminAuditLog.count({ where: { targetId: f.seller.id, action: 'delete_user' } }), 0);
});

test('PostgreSQL administrative permanent deletion still deletes an account that remains disabled', { timeout: 20_000 }, async t => {
  if (!permittedDatabase()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
  const response = await deleteUser(f.request('/api/admin/users/' + f.seller.id + '?mode=permanent', 'DELETE'), {
    params: Promise.resolve({ userId: f.seller.id }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'deleted');
  assert.equal(await prisma.user.findUnique({ where: { id: f.seller.id } }), null);
});

test.after(async () => { await prisma.$disconnect(); });
