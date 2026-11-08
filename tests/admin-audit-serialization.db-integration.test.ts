import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';
import { PATCH as editCommission } from '@/app/api/admin/commissions/[commissionId]/route';
import { PATCH as editSiteMessage } from '@/app/api/admin/site-message/route';
import { updateCommissionSaleAmountForSeller } from '@/agent/marketplace/repository';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function enabled() {
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
  const owner = await prisma.user.create({ data: { id: `serialized-owner-${suffix}`, email: `serialized-owner-${suffix}@example.test` } });
  const seller = await prisma.user.create({ data: { id: `serialized-seller-${suffix}`, email: `serialized-seller-${suffix}@example.test` } });
  const listing = await prisma.listing.create({ data: { sellerId: seller.id, category: 'furniture', title: 'Isolated audit fixture', status: 'sold' } });
  const commission = await prisma.commission.create({ data: { listingId: listing.id, sellerId: seller.id, status: 'due', productValue: 1000, commissionAmount: 10 } });
  const savedMessage = await prisma.siteMessage.findUnique({ where: { id: 'primary' } });
  for (const [key, value] of Object.entries({
    SMARTSTORE_ADMIN_EMAILS: owner.email, AUTH_SECRET: 'local-serialized-audits-only',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  t.after(async () => {
    if (savedMessage) await prisma.siteMessage.upsert({ where: { id: 'primary' }, create: savedMessage, update: savedMessage });
    else await prisma.siteMessage.deleteMany({ where: { id: 'primary' } });
    await prisma.adminAuditLog.deleteMany({ where: { adminId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, seller.id] } } });
  });
  const token = createSignedSession({ id: owner.id, email: owner.email });
  const request = (path: string, body: object) => new Request('https://example.test' + path, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { owner, seller, listing, commission, request };
}

const messagePayload = (message: string) => ({ message, type: 'info', isEnabled: true, expiresAt: null });

async function waitForDatabaseLock(pid: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const [state] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT "wait_event_type" = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${pid}`;
    if (state?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('the second transaction must wait for the first decision');
}

function pauseFirstAudit(t: TestContext) {
  const transaction = prisma.$transaction.bind(prisma);
  let resume!: () => void; let entered!: () => void; let secondEntered!: (pid: number) => void;
  const mayCommit = new Promise<void>(resolve => { resume = resolve; });
  const firstUpdated = new Promise<void>(resolve => { entered = resolve; });
  const secondStarted = new Promise<number>(resolve => { secondEntered = resolve; });
  let index = 0;
  mockDatabaseMethod(t, prisma, '$transaction', async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number } = {},
  ) => {
    const first = index++ === 0;
    return transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      if (!first) secondEntered(pid);
      const audit = new Proxy(tx.adminAuditLog, { get(target, key, receiver) {
        if (key !== 'create' || !first) return Reflect.get(target, key, receiver);
        return async (args: Prisma.AdminAuditLogCreateArgs) => {
          entered();
          await mayCommit;
          return tx.adminAuditLog.create(args);
        };
      } });
      return work(new Proxy(tx, { get(target, key, receiver) {
        return key === 'adminAuditLog' ? audit : Reflect.get(target, key, receiver);
      } }));
    }, { ...options, timeout: 15_000 });
  });
  return { resume, firstUpdated, secondStarted };
}

test('PostgreSQL concurrent commission decisions audit the actual preceding committed status', { timeout: 25_000 }, async t => {
  if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL database.');
  const f = await fixture(t);
  const pause = pauseFirstAudit(t);
  const decide = (status: string) => editCommission(f.request(`/api/admin/commissions/${f.commission.id}`, { status }), {
    params: Promise.resolve({ commissionId: f.commission.id }),
  });
  const first = decide('paid');
  let second: Promise<Response> | undefined;
  try {
    await pause.firstUpdated;
    second = decide('waived');
    await waitForDatabaseLock(await pause.secondStarted);
    pause.resume();
    assert.deepEqual((await Promise.all([first, second])).map(response => { assert.ok(response); return response.status; }), [200, 200]);
  } finally {
    pause.resume();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
  }
  const audits = await prisma.adminAuditLog.findMany({ where: { adminId: f.owner.id, targetId: f.commission.id } });
  assert.equal(audits.length, 2);
  const transitions = audits.map(row => row.metadata as { previousStatus: string; nextStatus: string });
  assert.equal(transitions.find(row => row.nextStatus === 'paid')?.previousStatus, 'due');
  assert.equal(transitions.find(row => row.nextStatus === 'waived')?.previousStatus, 'paid');
  assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, 'waived');
});

for (const initiallyExists of [false, true]) {
  test(`PostgreSQL singleton message audit remains ordered during concurrent ${initiallyExists ? 'updates' : 'first creation'}`, { timeout: 25_000 }, async t => {
    if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL database.');
    const f = await fixture(t);
    await prisma.siteMessage.deleteMany({ where: { id: 'primary' } });
    if (initiallyExists) await prisma.siteMessage.create({ data: { id: 'primary', message: 'initial', updatedById: f.owner.id } });
    const pause = pauseFirstAudit(t);
    const first = editSiteMessage(f.request('/api/admin/site-message', messagePayload('first')));
    let second: Promise<Response | undefined> | undefined;
    try {
      await pause.firstUpdated;
      second = editSiteMessage(f.request('/api/admin/site-message', messagePayload('second')));
      await waitForDatabaseLock(await pause.secondStarted);
      pause.resume();
      assert.deepEqual((await Promise.all([first, second])).map(response => { assert.ok(response); return response.status; }), [200, 200]);
    } finally {
      pause.resume();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
    const audits = await prisma.adminAuditLog.findMany({ where: { adminId: f.owner.id, action: 'update_site_message' } });
    assert.equal(audits.length, 2);
    const transitions = audits.map(row => row.metadata as { operation: string; previous: { message: string } | null; next: { message: string } });
    const firstChange = transitions.find(row => row.next.message === 'first')!;
    assert.equal(firstChange.previous?.message ?? null, initiallyExists ? 'initial' : null);
    assert.equal(firstChange.operation, initiallyExists ? 'site_message_update' : 'site_message_create');
    assert.equal(transitions.find(row => row.next.message === 'second')?.previous?.message, 'first');
    assert.equal((await prisma.siteMessage.findUniqueOrThrow({ where: { id: 'primary' } })).message, 'second');
  });
}

for (const target of ['commission', 'site_message'] as const) {
  test(`PostgreSQL ${target} audit failure rolls back the associated write`, { timeout: 20_000 }, async t => {
    if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL database.');
    const f = await fixture(t);
    await prisma.siteMessage.upsert({ where: { id: 'primary' }, create: { id: 'primary', message: 'initial' }, update: { message: 'initial' } });
    const transaction = prisma.$transaction.bind(prisma);
    mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => transaction(async tx => {
      const audit = new Proxy(tx.adminAuditLog, { get(delegate, key, receiver) {
        if (key === 'create') return async () => { throw new Error('injected_serialized_audit_failure'); };
        return Reflect.get(delegate, key, receiver);
      } });
      return work(new Proxy(tx, { get(delegate, key, receiver) {
        return key === 'adminAuditLog' ? audit : Reflect.get(delegate, key, receiver);
      } }));
    }, options));
    const mutation = target === 'commission'
      ? () => editCommission(f.request(`/api/admin/commissions/${f.commission.id}`, { status: 'paid' }), { params: Promise.resolve({ commissionId: f.commission.id }) })
      : () => editSiteMessage(f.request('/api/admin/site-message', messagePayload('must roll back')));
    await assert.rejects(mutation, /injected_serialized_audit_failure/);
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, 'due');
    assert.equal((await prisma.siteMessage.findUniqueOrThrow({ where: { id: 'primary' } })).message, 'initial');
    assert.equal(await prisma.adminAuditLog.count({ where: { adminId: f.owner.id } }), 0);
  });
}

test('PostgreSQL seller amount update waits for a paid decision and cannot unlock it', { timeout: 25_000 }, async t => {
  if (!enabled()) return t.skip('Requires the named disposable loopback PostgreSQL database.');
  const f = await fixture(t);
  const pause = pauseFirstAudit(t);
  const first = editCommission(f.request(`/api/admin/commissions/${f.commission.id}`, { status: 'paid' }), {
    params: Promise.resolve({ commissionId: f.commission.id }),
  });
  let sellerUpdate: ReturnType<typeof updateCommissionSaleAmountForSeller> | undefined;
  try {
    await pause.firstUpdated;
    sellerUpdate = updateCommissionSaleAmountForSeller(f.commission.id, f.seller.id, 2000);
    await waitForDatabaseLock(await pause.secondStarted);
    pause.resume();
    assert.equal((await first).status, 200);
    assert.equal((await sellerUpdate).status, 'locked');
  } finally {
    pause.resume();
    await Promise.allSettled([first, ...(sellerUpdate ? [sellerUpdate] : [])]);
  }
  const saved = await prisma.commission.findUniqueOrThrow({ where: { id: f.commission.id } });
  assert.equal(saved.status, 'paid');
  assert.equal(Number(saved.productValue), 1000);
});

test.after(async () => { await prisma.$disconnect(); });
