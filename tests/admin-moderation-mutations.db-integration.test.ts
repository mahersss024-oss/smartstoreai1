import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';
import { DELETE as deleteListing } from '@/app/api/admin/listings/[listingId]/route';
import { PATCH as resolveReport } from '@/app/api/admin/moderation/reports/[reportId]/route';
import { addConversationMessage, blockConversationUser, setReportModerationStatus, setUserReportModerationStatus, unblockConversationUser } from '@/agent/marketplace/repository';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function enabled() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

async function fixture(t: TestContext) {
  const suffix = randomUUID();
  const users = await Promise.all(['owner', 'seller', 'buyer'].map(role => prisma.user.create({ data: {
    id: `moderation-${role}-${suffix}`, email: `moderation-${role}-${suffix}@example.test`,
  } })));
  const [owner, seller, buyer] = users.map(user => ({ id: user.id, email: user.email }));
  for (const [key, value] of Object.entries({
    SMARTSTORE_ADMIN_EMAILS: owner.email, AUTH_SECRET: 'local-moderation-regressions-only',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  t.after(async () => {
    const cases = await prisma.evidenceCase.findMany({ where: { participantIds: { hasSome: users.map(user => user.id) } }, select: { id: true } });
    const ids = cases.map(value => value.id);
    await prisma.$transaction(async tx => {
      await tx.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposing' } });
      await tx.evidenceAsset.deleteMany({ where: { caseId: { in: ids } } });
      await tx.evidenceEvent.deleteMany({ where: { caseId: { in: ids } } });
      await tx.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { snapshot: {}, snapshotHash: '', participantIds: [], conversationIds: [], listingId: null, status: 'disposed' } });
      await tx.evidenceCase.deleteMany({ where: { id: { in: ids } } });
    });
    const messages = await prisma.conversationMessage.findMany({ where: { senderId: { in: users.map(user => user.id) } }, select: { id: true } });
    await prisma.notificationDeliveryJob.deleteMany({ where: { id: { in: messages.map(message => createHash('sha256').update(`conversation-message:${message.id}`).digest('hex')) } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  });
  const token = createSignedSession(owner);
  return { owner, seller, buyer, token };
}

test('PostgreSQL permanent listing deletion refuses a restore committed after its first read', { timeout: 20_000 }, async t => {
  if (!enabled()) return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const listing = await prisma.listing.create({ data: { sellerId: f.seller.id, category: 'furniture', title: 'Restored fixture', status: 'deleted' } });
  const transaction = prisma.$transaction.bind(prisma);
  let inject = true;
  mockDatabaseMethod(t, prisma, '$transaction', async (work: never, ...options: never[]) => {
    if (inject) { inject = false; await prisma.listing.update({ where: { id: listing.id }, data: { status: 'published' } }); }
    return transaction(work, ...options);
  });
  const response = await deleteListing(new Request(`https://example.test/api/admin/listings/${listing.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${f.token}` },
  }), { params: Promise.resolve({ listingId: listing.id }) });
  assert.equal(response.status, 409);
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status, 'published');
  assert.equal(await prisma.adminAuditLog.count({ where: { targetId: listing.id, action: 'delete_listing' } }), 0);
});

test('PostgreSQL concurrent report resolutions preserve one decision and one audit', { timeout: 20_000 }, async t => {
  if (!enabled()) return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const listing = await prisma.listing.create({ data: { sellerId: f.seller.id, category: 'furniture', title: 'Reported fixture', status: 'published' } });
  const report = await prisma.report.create({ data: { listingId: listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
  const results = await Promise.all([
    setReportModerationStatus(report.id, 'reviewed', f.owner),
    setReportModerationStatus(report.id, 'dismissed', f.owner),
  ]);
  assert.equal(results.filter(result => result.status === 'already_resolved').length, 1);
  const saved = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
  const audits = await prisma.adminAuditLog.findMany({ where: { targetType: 'report', targetId: report.id } });
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].metadata, { previousStatus: 'open', nextStatus: saved.status, listingId: listing.id, reporterId: f.buyer.id });
});

test('PostgreSQL report listing actions commit the decision listing and both audits together', { timeout: 20_000 }, async t => {
  if (!enabled()) return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const firstPublishedAt = new Date('2026-01-01T12:00:00Z');
  for (const [action, status] of [['reject_listing', 'rejected'], ['delete_listing', 'deleted']] as const) {
    const listing = await prisma.listing.create({ data: {
      sellerId: f.seller.id, category: 'furniture', title: 'Atomic report target', status: 'published', firstPublishedAt,
    } });
    const report = await prisma.report.create({ data: { listingId: listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
    const response = await resolveReport(new Request(`https://example.test/api/admin/moderation/reports/${report.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }), { params: Promise.resolve({ reportId: report.id }) });
    assert.equal(response.status, 200);
    const savedListing = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.equal(savedListing.status, status);
    assert.equal((savedListing.compliance as { humanDecision?: string }).humanDecision, 'block');
    assert.equal(savedListing.firstPublishedAt?.getTime(), firstPublishedAt.getTime());
    assert.equal((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status, 'reviewed');
    assert.equal(await prisma.adminAuditLog.count({ where: { targetId: { in: [listing.id, report.id] }, adminId: f.owner.id } }), 2);
    assert.equal((await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } })).status, 'closed');
  }
});

test('PostgreSQL concurrent dismiss and listing deletion cannot apply a losing report decision', { timeout: 20_000 }, async t => {
  if (!enabled()) return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const listing = await prisma.listing.create({ data: { sellerId: f.seller.id, category: 'furniture', title: 'Concurrent report target', status: 'published' } });
  const report = await prisma.report.create({ data: { listingId: listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
  const decide = (action: string) => resolveReport(new Request(`https://example.test/api/admin/moderation/reports/${report.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  }), { params: Promise.resolve({ reportId: report.id }) });
  const responses = await Promise.all([decide('dismiss'), decide('delete_listing')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
  const expectedListingStatus = winner.status === 'dismissed' ? 'published' : 'deleted';
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status, expectedListingStatus);
  assert.equal(await prisma.adminAuditLog.count({ where: { targetId: report.id, targetType: 'report' } }), 1);
  assert.equal(await prisma.adminAuditLog.count({ where: { targetId: listing.id, targetType: 'listing' } }), expectedListingStatus === 'deleted' ? 1 : 0);
  const later = await decide('reject_listing');
  assert.equal(later.status, 409);
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status, expectedListingStatus);
});

test('PostgreSQL a failed report audit rolls back its listing decision and evidence changes', { timeout: 20_000 }, async t => {
  if (!enabled()) return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const listing = await prisma.listing.create({ data: { sellerId: f.seller.id, category: 'furniture', title: 'Rollback report target', status: 'published' } });
  const report = await prisma.report.create({ data: { listingId: listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
  const transaction = prisma.$transaction.bind(prisma);
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => {
    const audit = new Proxy(tx.adminAuditLog, { get(target, key, receiver) {
      if (key !== 'create') return Reflect.get(target, key, receiver);
      return async (args: Prisma.AdminAuditLogCreateArgs) => {
        if (args.data.targetType === 'report') throw new Error('injected_report_audit_failure');
        return tx.adminAuditLog.create(args);
      };
    } });
    return work(new Proxy(tx, { get(target, key, receiver) {
      return key === 'adminAuditLog' ? audit : Reflect.get(target, key, receiver);
    } }));
  }));
  await assert.rejects(() => resolveReport(new Request(`https://example.test/api/admin/moderation/reports/${report.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_listing' }),
  }), { params: Promise.resolve({ reportId: report.id }) }), /injected_report_audit_failure/);
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status, 'published');
  assert.equal((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status, 'open');
  assert.equal(await prisma.adminAuditLog.count({ where: { targetId: { in: [listing.id, report.id] } } }), 0);
  const evidence = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
  assert.equal(evidence.status, 'open');
  assert.equal(await prisma.evidenceEvent.count({ where: { caseId: evidence.id, action: { in: ['Report.update', 'Listing.update'] } } }), 0);
});

test('PostgreSQL moderation waits for another conversation send and customers cannot remove the restriction', { timeout: 30_000 }, async t => {
  if (!enabled()) return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const f = await fixture(t);
  const listings = await Promise.all(['reported', 'other'].map(label => prisma.listing.create({ data: {
    sellerId: f.seller.id, category: 'furniture', title: `${label} local fixture`, status: 'published',
  } })));
  const conversations = await Promise.all(listings.map(listing => prisma.conversation.create({ data: {
    listingId: listing.id, buyerId: f.buyer.id, sellerId: f.seller.id,
  } })));
  const report = await prisma.userReport.create({ data: {
    conversationId: conversations[0].id, reporterId: f.buyer.id, targetUserId: f.seller.id, reason: 'fraud',
  } });
  const transaction = prisma.$transaction.bind(prisma);
  let entered!: () => void; let resume!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const maySend = new Promise<void>(resolve => { resume = resolve; });
  let paused = false;
  let moderationPid = 0;
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => {
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    const proxy = new Proxy(tx, { get(target, key, receiver) {
      if (key !== '$executeRaw') return Reflect.get(target, key, receiver);
      return async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join('?').includes('771207') && paused) moderationPid = pid;
        const result = await tx.$executeRaw(strings, ...values);
        if (!paused && strings.join('?').includes('771207')) { paused = true; entered(); await maySend; }
        return result;
      };
    } });
    return work(proxy);
  }, { timeout: 15_000 }));
  let sending: ReturnType<typeof addConversationMessage> | undefined;
  let restricting: ReturnType<typeof setUserReportModerationStatus> | undefined;
  try {
    sending = addConversationMessage(conversations[1].id, f.buyer, 'Message serialized before moderator restriction');
    await ready;
    restricting = setUserReportModerationStatus(report.id, 'restrict', f.owner);
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (moderationPid) {
        const rows = await prisma.$queryRaw<Array<{ wait: string | null }>>`SELECT wait_event AS wait FROM pg_stat_activity WHERE pid = ${moderationPid}`;
        if (rows[0]?.wait === 'advisory') { waiting = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'moderation must wait for the already protected same-pair send');
    resume();
    assert.equal((await sending).status, 'sent');
    assert.equal((await restricting).status, 'reviewed');
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: conversations[1].id } })).status, 'open');
    assert.equal((await blockConversationUser(conversations[1].id, f.buyer, 'personal_reason')).block?.reason, 'admin_moderation');
    assert.equal((await unblockConversationUser(conversations[1].id, f.buyer)).status, 'conversation_blocked');
    assert.equal((await addConversationMessage(conversations[1].id, f.seller, 'Blocked after moderation')).status, 'conversation_blocked');
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId: conversations[1].id } }), 1);
  } finally {
    resume();
    await Promise.allSettled([sending, restricting].filter(Boolean));
  }
});

test.after(async () => { await prisma.$disconnect(); });
