import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { actOnCaseEvidence, copyEvidenceAssets, evidenceHash, hasProtectedUserEvidence, readCaseEvidence } from '@/agent/marketplace/evidence';
import { createSessionCookie } from '@/lib/auth/session';
import { DELETE as deleteAccount } from '@/app/api/account/profile/route';
import { DELETE as adminDeleteAccount, PATCH as adminUpdateAccount } from '@/app/api/admin/users/[userId]/route';
import { GET as getAuthSession } from '@/app/api/auth/session/route';
import { persistGoogleUserRegistration } from '@/lib/auth/google';
import { persistUserRegistration, selfAccountDeletionOperation } from '@/lib/auth/registration';
import { acknowledgeReportNotification, listReportNotifications } from '@/lib/admin/report-notifications';

const enabled = process.env.SMARTSTORE_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);

test('database report notifications share concurrent acknowledgements without resolving either report type', { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const report = await prisma.report.create({ data: { listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
    const conversationReport = await prisma.userReport.create({ data: { reporterId: f.buyer.id, targetUserId: f.seller.id, conversationId: f.conversation.id, reason: 'conversation_report' } });
    const evidence = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
    const otherCase = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'UserReport', sourceId: conversationReport.id } } });
    const before = await listReportNotifications(1, 48);
    assert.ok(before.notifications.some(item => item.id === evidence.id && item.title === 'Original desk'));
    assert.ok(before.notifications.some(item => item.id === otherCase.id && item.sourceType === 'UserReport'));
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => acknowledgeReportNotification(evidence.id, index % 2 ? f.buyer.id : f.seller.id)));
    assert.ok(results.every(Boolean));
    const events = await prisma.evidenceEvent.findMany({ where: { caseId: evidence.id, action: 'notification.viewed' } });
    assert.equal(events.length, 1);
    assert.ok([f.buyer.id, f.seller.id].includes(events[0].actorId!));
    assert.equal((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status, 'open');
    assert.equal((await prisma.userReport.findUniqueOrThrow({ where: { id: conversationReport.id } })).status, 'open');
    const after = await listReportNotifications(1, 48);
    assert.ok(!after.notifications.some(item => item.id === evidence.id));
    assert.ok(after.notifications.some(item => item.id === otherCase.id));
    const preserved = await prisma.evidenceCase.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(preserved.snapshotHash, evidence.snapshotHash);
    assert.deepEqual(preserved.snapshot, evidence.snapshot);
    assert.equal(preserved.status, 'open');
  } finally { await cleanup(f); }
});

async function fixture() {
  const suffix = randomUUID();
  const seller = await prisma.user.create({ data: { id: `evidence-seller-${suffix}`, email: `evidence-seller-${suffix}@example.test` } });
  const buyer = await prisma.user.create({ data: { id: `evidence-buyer-${suffix}`, email: `evidence-buyer-${suffix}@example.test` } });
  const other = await prisma.user.create({ data: { id: `evidence-other-${suffix}`, email: `evidence-other-${suffix}@example.test` } });
  const listing = await prisma.listing.create({ data: { sellerId: seller.id, category: 'other', title: 'Original desk', description: 'Original description', price: 100, status: 'published' } });
  const conversation = await prisma.conversation.create({ data: { listingId: listing.id, sellerId: seller.id, buyerId: buyer.id } });
  const unrelated = await prisma.conversation.create({ data: { listingId: listing.id, sellerId: seller.id, buyerId: other.id } });
  await prisma.conversationMessage.createMany({ data: Array.from({ length: 65 }, (_, i) => ({ conversationId: conversation.id, senderId: seller.id, body: `original-${i}` })) });
  await prisma.conversationMessage.create({ data: { conversationId: unrelated.id, senderId: other.id, body: 'unrelated private message' } });
  return { seller, buyer, other, listing, conversation, unrelated };
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>, extraUsers: string[] = []) {
  const cases = await prisma.evidenceCase.findMany({ where: { OR: [{ listingId: f.listing.id }, { sourceId: { in: (await prisma.report.findMany({ where: { listingId: f.listing.id }, select: { id: true } })).map(r => r.id) } }] }, select: { id: true } });
  const ids = cases.map(c => c.id);
  // Dedicated integration database only: fixture cleanup is not a product operation.
  await prisma.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposing' } });
  await prisma.evidenceEvent.deleteMany({ where: { caseId: { in: ids } } });
  await prisma.evidenceAsset.deleteMany({ where: { caseId: { in: ids } } });
  await prisma.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposed', snapshot: {}, snapshotHash: '', participantIds: [], conversationIds: [], listingId: null } });
  await prisma.evidenceCase.deleteMany({ where: { id: { in: ids } } });
  const userIds = [f.seller.id, f.buyer.id, f.other.id, ...extraUsers];
  await prisma.adminAuditLog.deleteMany({ where: { targetType: 'user', targetId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test('database evidence captures all related messages, excludes other buyers, preserves versions and guards cascades', { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const report = await prisma.report.create({ data: { listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
    const evidence = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
    const snapshot = evidence.snapshot as { listing: { title: string }; messages: Array<{ id: string; body: string }> };
    assert.equal(snapshot.messages.length, 65);
    assert.ok(snapshot.messages.every(m => m.body !== 'unrelated private message'));
    assert.equal(snapshot.listing.title, 'Original desk');
    assert.equal(evidence.snapshotHash.length, 64);
    const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
    process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
    try {
      const first = await readCaseEvidence('Report', report.id, f.seller.id, new Request('http://localhost/evidence?page=1'));
      const second = await readCaseEvidence('Report', report.id, f.seller.id, new Request('http://localhost/evidence?page=2'));
      assert.equal((await first.json()).evidenceCase.snapshot.messages.length, 50);
      assert.equal((await second.json()).evidenceCase.snapshot.messages.length, 15);
      assert.ok(await prisma.adminAuditLog.count({ where: { adminId: f.seller.id, action: 'manage_evidence', targetId: evidence.id } }));
    } finally { if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore; }
    await prisma.listing.update({ where: { id: f.listing.id }, data: { title: 'Edited normally' } });
    const message = snapshot.messages[0];
    await prisma.conversationMessage.update({ where: { id: message.id }, data: { body: 'message_deleted', type: 'message_deleted' } });
    const preserved = await prisma.evidenceCase.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.deepEqual(preserved.snapshot, evidence.snapshot);
    assert.equal(preserved.snapshotHash, evidence.snapshotHash);
    assert.ok(await prisma.evidenceEvent.count({ where: { caseId: evidence.id, action: 'Listing.update' } }));
    assert.ok(await prisma.evidenceEvent.count({ where: { caseId: evidence.id, action: 'ConversationMessage.update' } }));
    for (const erase of [
      () => prisma.user.delete({ where: { id: f.seller.id } }),
      () => prisma.user.delete({ where: { id: f.buyer.id } }),
      () => prisma.listing.delete({ where: { id: f.listing.id } }),
      () => prisma.conversation.delete({ where: { id: f.conversation.id } }),
      () => prisma.report.delete({ where: { id: report.id } }),
    ]) await assert.rejects(erase, /evidence_protected/);
    assert.equal(await hasProtectedUserEvidence(f.seller.id), true);
    await prisma.report.update({ where: { id: report.id }, data: { status: 'reviewed' } });
    const closed = await prisma.evidenceCase.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(closed.status, 'closed');
    assert.ok(closed.closedAt && closed.retainUntil);
    assert.equal(closed.retainUntil.getTime() - closed.closedAt.getTime(), 180 * 86_400_000);
    await assert.rejects(() => prisma.report.delete({ where: { id: report.id } }), /evidence_protected/);
  } finally { await cleanup(f); }
});

test('database evidence preserves image sources on failed copy and permits unrelated edits', { skip: !enabled }, async () => {
  const f = await fixture();
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    const image = await prisma.listingImage.create({ data: { listingId: f.listing.id, originalUrl: 'https://untrusted.example/picture.webp', displayUrl: 'https://untrusted.example/display.webp', thumbnailUrl: 'https://untrusted.example/thumb.webp', qualityScore: 90, status: 'approved' } });
    const report = await prisma.userReport.create({ data: { reporterId: f.buyer.id, targetUserId: f.seller.id, conversationId: f.conversation.id, reason: 'abuse' } });
    const evidence = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'UserReport', sourceId: report.id } } });
    assert.equal(await prisma.evidenceAsset.count({ where: { caseId: evidence.id } }), 3);
    await assert.rejects(() => prisma.listingImage.delete({ where: { id: image.id } }), /evidence_copy_pending/);
    await prisma.listing.update({ where: { id: f.listing.id }, data: { price: 150 } });
    await copyEvidenceAssets('UserReport', report.id);
    assert.equal((await prisma.evidenceCase.findUniqueOrThrow({ where: { id: evidence.id } })).captureStatus, 'incomplete');
    assert.equal(await prisma.evidenceAsset.count({ where: { caseId: evidence.id, status: 'failed' } }), 3);
    await assert.rejects(() => prisma.listingImage.delete({ where: { id: image.id } }), /evidence_copy_pending/);
    const untouched = await prisma.conversationMessage.create({ data: { conversationId: f.unrelated.id, senderId: f.other.id, body: 'still unrelated' } });
    assert.equal(await prisma.evidenceEvent.count({ where: { caseId: evidence.id, payload: { path: ['after', 'id'], equals: untouched.id } } }), 0);
  } finally { await cleanup(f); if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; }
});

test('database self-deletion permits fresh registration while retaining evidence and rejecting old sessions', { skip: !enabled }, async () => {
  const f = await fixture();
  const extraUsers: string[] = [];
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    const report = await prisma.report.create({ data: { listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
    const evidence = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
    await prisma.user.update({ where: { id: f.seller.id }, data: { role: 'moderator' } });
    await prisma.pushSubscription.create({ data: { userId: f.seller.id, endpoint: `https://push.example.test/${f.seller.id}`, p256dh: 'synthetic', auth: 'synthetic' } });
    await prisma.mobilePushToken.create({ data: { userId: f.seller.id, token: `synthetic-${f.seller.id}`, platform: 'android' } });
    const cookie = createSessionCookie({ id: f.seller.id, email: f.seller.email }).split(';')[0];
    const result = await deleteAccount(new Request('http://localhost/api/account/profile', { method: 'DELETE', headers: { Cookie: cookie } }));
    assert.equal(result.status, 200);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: f.seller.id } })).deletedAt);
    assert.equal(await prisma.listing.count({ where: { id: f.listing.id } }), 1);
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).status, 'deleted');
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } })).status, 'closed');
    assert.equal(await prisma.pushSubscription.count({ where: { userId: f.seller.id } }), 0);
    assert.equal(await prisma.mobilePushToken.count({ where: { userId: f.seller.id } }), 0);
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId: f.conversation.id } }), 65);
    assert.equal(await prisma.report.count({ where: { listingId: f.listing.id } }), 1);
    const marker = await prisma.adminAuditLog.findFirstOrThrow({ where: {
      targetType: 'user', targetId: f.seller.id, action: 'delete_user',
      metadata: { path: ['operation'], equals: selfAccountDeletionOperation },
    } });
    assert.equal(marker.adminId, null);
    const registration = await persistGoogleUserRegistration(new Request('http://localhost/register'), {
      id: f.seller.id, email: f.seller.email, name: 'Returning customer',
    });
    extraUsers.push(registration.id);
    assert.notEqual(registration.id, f.seller.id);
    assert.equal(registration.role, 'user');
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: f.seller.id } })).deletedAt);
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).status, 'deleted');
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } })).status, 'closed');
    assert.equal(await prisma.listing.count({ where: { sellerId: registration.id } }), 0);
    assert.equal(await prisma.conversationMessage.count({ where: { senderId: registration.id } }), 0);
    const after = await prisma.evidenceCase.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.deepEqual(after.snapshot, evidence.snapshot);
    assert.equal(after.snapshotHash, evidence.snapshotHash);
    const oldSession = await getAuthSession(new Request('http://localhost/api/auth/session', { headers: { Cookie: cookie } }));
    assert.equal((await oldSession.json()).authenticated, false);
    const newSession = await getAuthSession(new Request('http://localhost/api/auth/session', {
      headers: { Cookie: createSessionCookie(registration).split(';')[0] },
    }));
    assert.equal((await newSession.json()).authenticated, true);
    const repeated = await persistUserRegistration(new Request('http://localhost/register'), {
      id: `apple:${f.seller.id}`, email: f.seller.email,
    });
    assert.equal(repeated.id, registration.id);

    // A later administrative deletion of the retained identity must still
    // prevent sign-in, including through a different identity provider.
    const previousOwners = process.env.SMARTSTORE_ADMIN_EMAILS;
    process.env.SMARTSTORE_ADMIN_EMAILS = f.other.email;
    try {
      const response = await adminDeleteAccount(new Request(`http://localhost/api/admin/users/${f.seller.id}`, {
        method: 'DELETE', headers: { Cookie: createSessionCookie({ id: f.other.id, email: f.other.email }).split(';')[0] },
      }), { params: Promise.resolve({ userId: f.seller.id }) });
      assert.equal(response.status, 200);
      await assert.rejects(persistUserRegistration(new Request('http://localhost/register'), {
        id: `apple:${f.seller.id}`, email: f.seller.email,
      }), /ACCOUNT_SOFT_DELETED/);
    } finally {
      if (previousOwners === undefined) delete process.env.SMARTSTORE_ADMIN_EMAILS;
      else process.env.SMARTSTORE_ADMIN_EMAILS = previousOwners;
    }
  } finally { await cleanup(f, extraUsers); if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; }
});

test('database permanent self-deletion supports concurrent cross-provider registration without restoring old cookies', { skip: !enabled }, async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { id: `google:self-${suffix}`, email: `self-${suffix}@example.test` } });
  const createdIds: string[] = [];
  try {
    const cookie = createSessionCookie({ id: user.id, email: user.email }).split(';')[0];
    const response = await deleteAccount(new Request('http://localhost/api/account/profile', {
      method: 'DELETE', headers: { Cookie: cookie },
    }));
    assert.equal(response.status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
    const identity = { id: user.id, email: user.email };
    const results = await Promise.all([
      persistGoogleUserRegistration(new Request('http://localhost/register'), identity),
      persistUserRegistration(new Request('http://localhost/register'), { ...identity, id: `apple:self-${suffix}` }),
    ]);
    createdIds.push(...results.map(result => result.id));
    assert.equal(results[0].id, results[1].id);
    assert.notEqual(results[0].id, user.id);
    assert.equal(await prisma.user.count({ where: { email: user.email } }), 1);
    assert.equal((await (await getAuthSession(new Request('http://localhost/api/auth/session', {
      headers: { Cookie: cookie },
    }))).json()).authenticated, false);
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { targetType: 'user', targetId: user.id } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: [user.id, ...createdIds] } }, { email: user.email }] } });
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database administrative deletion blocks re-registration until explicit reactivation and survives permanent removal', { skip: !enabled }, async () => {
  const previous = { store: process.env.SMARTSTORE_MARKETPLACE_STORE, owners: process.env.SMARTSTORE_ADMIN_EMAILS };
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const suffix = randomUUID();
  const owner = await prisma.user.create({ data: { id: `owner-${suffix}`, email: `owner-${suffix}@example.test` } });
  const user = await prisma.user.create({ data: { id: `google:admin-deleted-${suffix}`, email: `admin-deleted-${suffix}@example.test` } });
  process.env.SMARTSTORE_ADMIN_EMAILS = owner.email;
  const headers = { Cookie: createSessionCookie({ id: owner.id, email: owner.email }).split(';')[0], 'Content-Type': 'application/json' };
  const context = { params: Promise.resolve({ userId: user.id }) };
  const url = `http://localhost/api/admin/users/${user.id}`;
  const identity = { id: user.id, email: user.email };
  try {
    assert.equal((await adminDeleteAccount(new Request(url, { method: 'DELETE', headers }), context)).status, 200);
    await assert.rejects(persistGoogleUserRegistration(new Request('http://localhost/register'), identity), /ACCOUNT_SOFT_DELETED/);
    assert.equal((await adminUpdateAccount(new Request(url, {
      method: 'PATCH', headers, body: JSON.stringify({ accountStatus: 'active' }),
    }), context)).status, 200);
    assert.equal((await persistGoogleUserRegistration(new Request('http://localhost/register'), identity)).id, user.id);
    assert.equal((await adminDeleteAccount(new Request(url, { method: 'DELETE', headers }), context)).status, 200);
    assert.equal((await adminDeleteAccount(new Request(`${url}?mode=permanent`, { method: 'DELETE', headers }), context)).status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
    await assert.rejects(persistUserRegistration(new Request('http://localhost/register'), {
      id: `apple:new-${suffix}`, email: user.email,
    }), /ACCOUNT_SOFT_DELETED/);
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { targetType: 'user', targetId: user.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, owner.id] } } });
    if (previous.store === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous.store;
    if (previous.owners === undefined) delete process.env.SMARTSTORE_ADMIN_EMAILS;
    else process.env.SMARTSTORE_ADMIN_EMAILS = previous.owners;
  }
});

test('database evidence verifies private image copies and original image deletion cannot remove them', { skip: !enabled }, async t => {
  const f = await fixture();
  const env = { ...process.env };
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
  process.env.SMARTSTORE_OBJECT_STORAGE_BUCKET = 'public-listings';
  process.env.SMARTSTORE_EVIDENCE_STORAGE_BUCKET = 'private-evidence';
  process.env.SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID = 'test-only';
  process.env.SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'test-only';
  const objects = new Map<string, Uint8Array>();
  // A transient failure now retries within the storage operation. Exhaust that
  // budget to exercise durable disposal recovery on the next explicit action.
  let failedDeletesRemaining = 3;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const key = new URL(String(url)).pathname;
    assert.ok(key.startsWith('/private-evidence/'));
    if (init?.method === 'PUT') {
      assert.equal((init.headers as Record<string, string>)['Cache-Control'], 'private, no-store');
      objects.set(key, new Uint8Array(init.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (init?.method === 'DELETE') {
      if (failedDeletesRemaining-- > 0) return new Response(null, { status: 503 });
      objects.delete(key); return new Response(null, { status: 204 });
    }
    const value = objects.get(key);
    return value ? new Response(new Uint8Array(value), { headers: { 'Content-Type': 'image/webp' } }) : new Response(null, { status: 404 });
  });
  try {
    const bytes = Buffer.alloc(32 * 1024, 7);
    const url = `data:image/webp;base64,${bytes.toString('base64')}`;
    const image = await prisma.listingImage.create({ data: { listingId: f.listing.id, originalUrl: url, displayUrl: url, thumbnailUrl: url, qualityScore: 90, status: 'approved' } });
    const report = await prisma.report.create({ data: { listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
    await copyEvidenceAssets('Report', report.id);
    const c = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
    assert.equal(c.captureStatus, 'complete');
    const asset = await prisma.evidenceAsset.findFirstOrThrow({ where: { caseId: c.id } });
    assert.equal(asset.sha256, evidenceHash(bytes));
    await prisma.listingImage.delete({ where: { id: image.id } });
    const read = await readCaseEvidence('Report', report.id, f.seller.id, new Request(`http://localhost/evidence?asset=${asset.id}`));
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
    assert.match(read.headers.get('cache-control')!, /no-store/);
    await assert.rejects(() => prisma.evidenceCase.update({ where: { id: c.id }, data: { snapshot: {} } }), /immutable_evidence_snapshot/);
    await assert.rejects(() => prisma.evidenceEvent.deleteMany({ where: { caseId: c.id } }), /evidence_protected/);
    process.env.SMARTSTORE_ADMIN_EMAILS = f.seller.email;
    const session = { user: { id: f.seller.id, email: f.seller.email }, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 };
    await prisma.report.update({ where: { id: report.id }, data: { status: 'reviewed' } });
    await prisma.evidenceCase.update({ where: { id: c.id }, data: { retainUntil: new Date(Date.now() - 1000), closedAt: new Date(Date.now() - 181 * 86_400_000) } });
    const action = { action: 'evidence_dispose', reason: 'Synthetic retention cleanup', confirmation: 'إتلاف الأدلة' };
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 503);
    assert.equal((await prisma.evidenceCase.findUniqueOrThrow({ where: { id: c.id } })).status, 'disposing');
    assert.equal(await prisma.evidenceAsset.count({ where: { caseId: c.id } }), 1);
    assert.equal(objects.size, 1);
    await prisma.listing.update({ where: { id: f.listing.id }, data: { title: 'Editing stays available during disposal recovery' } });
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 200);
    assert.equal(objects.size, 0);
    assert.equal((await prisma.evidenceCase.findUniqueOrThrow({ where: { id: c.id } })).status, 'disposed');
    assert.equal(await prisma.evidenceAsset.count({ where: { caseId: c.id } }), 0);
    assert.ok(await prisma.adminAuditLog.count({ where: { targetId: c.id, action: 'manage_evidence' } }));
    await prisma.evidenceEvent.deleteMany({ where: { caseId: c.id } });
    await prisma.evidenceCase.delete({ where: { id: c.id } });
  } finally {
    t.mock.restoreAll(); await cleanup(f);
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});

test('database disposal enforces closure, 180 days, explicit confirmation, holds, outstanding fees and administrator authority', { skip: !enabled }, async () => {
  const f = await fixture();
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const previousOwners = process.env.SMARTSTORE_ADMIN_EMAILS;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_ADMIN_EMAILS = 'evidence-owner@example.test';
  const session = { user: { id: 'evidence-owner', email: 'evidence-owner@example.test', role: 'admin' }, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 };
  const action = { action: 'evidence_dispose', reason: 'Synthetic test disposal', confirmation: 'إتلاف الأدلة' };
  try {
    const report = await prisma.report.create({ data: { listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
    const c = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
    assert.equal((await actOnCaseEvidence('Report', report.id, { ...session, user: { ...session.user, email: 'not-owner@example.test' } }, action))?.status, 403);
    assert.equal((await actOnCaseEvidence('Report', report.id, session, { ...action, confirmation: '' }))?.status, 400);
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 409);
    await prisma.report.update({ where: { id: report.id }, data: { status: 'reviewed' } });
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 409);
    await prisma.evidenceCase.update({ where: { id: c.id }, data: { retainUntil: new Date(Date.now() - 1000), closedAt: new Date(Date.now() - 181 * 86_400_000), legalHold: true } });
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 409);
    assert.equal((await actOnCaseEvidence('Report', report.id, session, { action: 'evidence_release', reason: 'Test release of hold' }))?.status, 200);
    const commission = await prisma.commission.create({ data: { listingId: f.listing.id, sellerId: f.seller.id } });
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 409);
    await prisma.commission.update({ where: { id: commission.id }, data: { status: 'paid' } });
    const extension = await actOnCaseEvidence('Report', report.id, session, { action: 'evidence_extend', days: 180, reason: 'Test retention extension' });
    assert.equal(extension?.status, 200);
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 409);
    await prisma.evidenceCase.update({ where: { id: c.id }, data: { retainUntil: new Date(Date.now() - 1000) } });
    assert.equal((await actOnCaseEvidence('Report', report.id, session, action))?.status, 200);
    const disposed = await prisma.evidenceCase.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(disposed.status, 'disposed');
    assert.deepEqual(disposed.snapshot, {});
    assert.deepEqual(disposed.participantIds, []);
    assert.equal(await prisma.evidenceEvent.count({ where: { caseId: c.id } }), 1);
    await prisma.report.delete({ where: { id: report.id } });
    await prisma.evidenceEvent.deleteMany({ where: { caseId: c.id } });
    await prisma.evidenceCase.delete({ where: { id: c.id } });
  } finally {
    await cleanup(f);
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    if (previousOwners === undefined) delete process.env.SMARTSTORE_ADMIN_EMAILS; else process.env.SMARTSTORE_ADMIN_EMAILS = previousOwners;
  }
});

test('database report commit serializes a concurrent image deletion without losing its source', { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const image = await prisma.listingImage.create({ data: { listingId: f.listing.id, originalUrl: 'https://example.test/original.webp', displayUrl: 'https://example.test/display.webp', thumbnailUrl: 'https://example.test/thumb.webp', qualityScore: 90, status: 'approved' } });
    let captured!: () => void;
    let release!: () => void;
    const captureReady = new Promise<void>(resolve => { captured = resolve; });
    const mayCommit = new Promise<void>(resolve => { release = resolve; });
    const reportTransaction = prisma.$transaction(async tx => {
      const report = await tx.report.create({ data: { listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud' } });
      captured();
      await mayCommit;
      return report;
    });
    await captureReady;
    const deletion = prisma.listingImage.delete({ where: { id: image.id } });
    const result = assert.rejects(() => deletion, /evidence_copy_pending/);
    release();
    const report = await reportTransaction;
    await result;
    const evidence = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: report.id } } });
    assert.equal(await prisma.evidenceAsset.count({ where: { caseId: evidence.id } }), 3);
    assert.equal(await prisma.listingImage.count({ where: { id: image.id } }), 1);
  } finally { await cleanup(f); }
});

test('legacy backfill labels surviving data and does not rewrite marketplace records', { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const id = `legacy-${randomUUID()}`;
    await prisma.$transaction(async tx => {
      // Reproduce a pre-migration report in the isolated PostgreSQL test database.
      await tx.$executeRawUnsafe('ALTER TABLE "Report" DISABLE TRIGGER evidence_capture');
      await tx.report.create({ data: { id, listingId: f.listing.id, reporterId: f.buyer.id, reason: 'fraud', status: 'reviewed' } });
      await tx.$executeRawUnsafe('ALTER TABLE "Report" ENABLE TRIGGER evidence_capture');
      await tx.$executeRawUnsafe('CREATE TRIGGER evidence_test_backfill AFTER UPDATE ON "Report" FOR EACH ROW EXECUTE FUNCTION evidence_open_case(\'legacy\')');
      await tx.report.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.$executeRawUnsafe('DROP TRIGGER evidence_test_backfill ON "Report"');
    });
    const c = await prisma.evidenceCase.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'Report', sourceId: id } } });
    assert.equal(c.status, 'closed');
    assert.equal((c.snapshot as { messages: unknown[] }).messages.length, 65);
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).title, 'Original desk');
    const event = await prisma.evidenceEvent.findFirstOrThrow({ where: { caseId: c.id, action: 'case.opened' } });
    assert.deepEqual(event.payload, { legacy: true });
  } finally { await cleanup(f); }
});

test.after(async () => { await prisma.$disconnect(); });
