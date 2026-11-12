import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { reserveChatGeneration } from '@/lib/chat/admission';
import { assertStaffMutationAccess } from '@/lib/auth/staff-mutation';
import { createSignedSession, parseSignedSession, type AuthSession } from '@/lib/auth/session';
import { persistUserRegistration } from '@/lib/auth/registration';
import { getVerifiedRoleForSession } from '@/lib/auth/authorization';
import { resolveRealtimeSubscriberContext } from '@/lib/realtime/authorization';
import { createMobileAuthTicket } from '@/lib/auth/mobile-oauth';
import { GET as exchangeTicket } from '@/app/api/auth/mobile/exchange/route';
import { GET as readSession } from '@/app/api/auth/session/route';
import { PATCH as editListing } from '@/app/api/admin/listings/[listingId]/route';
import { proxy } from '@/proxy';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function enabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}
function environment(t: TestContext, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
async function fixture(t: TestContext) {
  const suffix = randomUUID();
  const users = await Promise.all(['customer', 'moderator', 'owner'].map((label, i) => prisma.user.create({ data: {
    id: `auth-chat-${label}-${suffix}`, email: `auth-chat-${label}-${suffix}@example.test`, role: i === 1 ? 'moderator' : 'user',
  } })));
  const [customer, moderator, owner] = users;
  environment(t, { AUTH_SECRET: 'local-auth-chat-controls-only', SMARTSTORE_ADMIN_EMAILS: owner.email,
    SMARTSTORE_CHAT_MAX_CONCURRENT_PER_USER: '2', SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '0',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  const session = (user: typeof customer): AuthSession => parseSignedSession(createSignedSession({ id: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion }))!;
  t.after(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminId: { in: users.map(user => user.id) } }, { targetId: { in: users.map(user => user.id) } }] } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  });
  return { customer, moderator, owner, session };
}

test('PostgreSQL admission atomically bounds concurrent leases and preserves profile timestamps', { timeout: 20000 }, async t => {
  if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => reserveChatGeneration(f.session(f.customer))));
  t.after(async () => { await Promise.all(results.map(result => result.release())); });
  assert.equal(results.filter(result => !result.response).length, 2);
  assert.ok(results.filter(result => result.response).every(result => result.response!.status === 429));
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: f.customer.id } });
  const usage = saved.chatUsage as { requests: number; leases: Record<string, number> };
  assert.equal(usage.requests, 2); assert.equal(Object.keys(usage.leases).length, 2);
  assert.equal(saved.updatedAt.getTime(), f.customer.updatedAt.getTime());
  const other = await reserveChatGeneration(f.session(f.moderator)); assert.equal(other.response, undefined); await other.release();
  await results.find(result => !result.response)!.release();
  const replacement = await reserveChatGeneration(f.session(f.customer)); assert.equal(replacement.response, undefined); await replacement.release();
});

test('PostgreSQL daily admission count is durable across released requests and enforces an opted-in allowance', { timeout: 20000 }, async t => {
  if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t); environment(t, { SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '3' });
  for (let i = 0; i < 3; i++) { const lease = await reserveChatGeneration(f.session(f.customer)); assert.equal(lease.response, undefined); await lease.release(); }
  const blocked = await reserveChatGeneration(f.session(f.customer));
  assert.equal((await blocked.response!.json()).error, 'chat_daily_limit_reached');
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: f.customer.id } });
  assert.equal((saved.chatUsage as { requests: number }).requests, 3);
});

test('deactivation and restoration permanently revoke old cookie, bearer, SSE and mobile-ticket sessions; fresh verified sign-in obtains the new version', { timeout: 20000 }, async t => {
  if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t); const old = f.session(f.customer); const oldToken = createSignedSession(old.user);
  const ticket = createMobileAuthTicket(old.user);
  await prisma.user.update({ where: { id: f.customer.id }, data: { deletedAt: new Date() } });
  await prisma.user.update({ where: { id: f.customer.id }, data: { deletedAt: null } });
  const restored = await prisma.user.findUniqueOrThrow({ where: { id: f.customer.id } }); assert.equal(restored.sessionVersion, 1);
  const request = new NextRequest('https://example.test/api/marketplace/listings', { headers: { authorization: 'Bearer ' + oldToken } });
  assert.equal((await proxy(request)).status, 401);
  const cookie = `smartstore_session=${encodeURIComponent(oldToken)}`;
  assert.equal((await proxy(new NextRequest(request.url, { headers: { cookie } }))).status, 401);
  assert.equal((await (await readSession(new Request('https://example.test/api/auth/session', { headers: { cookie } }))).json()).authenticated, false);
  assert.equal(await getVerifiedRoleForSession(old), null); assert.equal(await resolveRealtimeSubscriberContext(old), null);
  assert.equal((await exchangeTicket(new Request('https://example.test/api/auth/mobile/exchange?ticket=' + encodeURIComponent(ticket)))).status, 400);
  assert.equal((await reserveChatGeneration(old)).response?.status, 401);
  const registered = await persistUserRegistration(new Request('https://example.test/api/auth/fixture'), { id: f.customer.id, email: f.customer.email });
  assert.equal(registered.sessionVersion, 1);
  const fresh = parseSignedSession(createSignedSession(registered))!;
  assert.equal(await getVerifiedRoleForSession(fresh), 'user');
  assert.equal((await proxy(new NextRequest(request.url, { headers: { authorization: 'Bearer ' + createSignedSession(registered) } }))).status, 200);
  const lease = await reserveChatGeneration(fresh); assert.equal(lease.response, undefined); await lease.release();
});

for (const change of ['demoted', 'disabled_then_restored'] as const) {
  test(`administrative listing mutation rolls back when actor is ${change} after admission`, { timeout: 20000 }, async t => {
    if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
    const f = await fixture(t);
    const listing = await prisma.listing.create({ data: { sellerId: f.customer.id, category: 'other', title: 'Original fixture', status: 'draft' } });
    const transaction = prisma.$transaction.bind(prisma); let inject = true;
    mockDatabaseMethod(t, prisma, '$transaction', async (callback: never, ...options: never[]) => {
      if (inject) {
        inject = false;
        if (change === 'demoted') await prisma.user.update({ where: { id: f.moderator.id }, data: { role: 'user' } });
        else {
          await prisma.user.update({ where: { id: f.moderator.id }, data: { deletedAt: new Date() } });
          await prisma.user.update({ where: { id: f.moderator.id }, data: { deletedAt: null } });
        }
      }
      return transaction(callback, ...options);
    });
    const token = createSignedSession(f.session(f.moderator).user);
    const response = await editListing(new Request('https://example.test/api/admin/listings/' + listing.id, { method: 'PATCH',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Must not commit' }),
    }), { params: Promise.resolve({ listingId: listing.id }) });
    assert.equal(response.status, 403);
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).title, 'Original fixture');
    assert.equal(await prisma.adminAuditLog.count({ where: { targetId: listing.id, action: 'update_listing' } }), 0);
  });
}

test('transaction authorization holds the acting account against deactivation until the authorized write commits', { timeout: 20000 }, async t => {
  if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL test database.');
  const f = await fixture(t); let release!: () => void; let acquired!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { acquired = resolve; });
  const writing = prisma.$transaction(async tx => { await assertStaffMutationAccess(tx, f.session(f.moderator), 'moderator'); acquired(); await barrier; });
  await ready;
  let deactivated = false;
  const revoking = prisma.user.update({ where: { id: f.moderator.id }, data: { deletedAt: new Date() } }).then(() => { deactivated = true; });
  try { await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(deactivated, false); }
  finally { release(); }
  await writing; await revoking; assert.equal(deactivated, true);
});

test.after(async () => { await prisma.$disconnect(); });
