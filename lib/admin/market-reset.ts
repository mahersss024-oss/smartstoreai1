import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { enqueueEvidenceObjectCleanup } from '@/agent/marketplace/image-object-cleanup';
import { accountSecurityAuditWhere, clearResettableAdminAuditHistory } from '@/lib/auth/registration';

export const marketResetConfirmation = 'حذف بيانات السوق والإبقاء على المستخدمين';
const purpose = 'owner-market-reset-v1';
const previewLifetimeMs = 10 * 60_000;
export const marketResetMaxRows = 50_000;

// Explicit inventory, not arbitrary table names received from a browser.
// New models must be reviewed before a destructive preview can be executed.
export const marketResetModels = [
  { kind: 'Listing', label: 'الإعلانات', mode: 'delete' },
  { kind: 'ListingImage', label: 'صور الإعلانات', mode: 'delete' },
  { kind: 'ListingImageUpload', label: 'سجلات رفع الصور', mode: 'cleanup' },
  { kind: 'ImageObjectCleanup', label: 'مهام تنظيف الملفات', mode: 'cleanup' },
  { kind: 'Conversation', label: 'المحادثات', mode: 'delete' },
  { kind: 'ConversationMessage', label: 'رسائل المحادثات', mode: 'delete' },
  { kind: 'Favorite', label: 'المفضلة', mode: 'delete' },
  { kind: 'SellerFollow', label: 'متابعة المعلنين', mode: 'delete' },
  { kind: 'SimilarListingFollow', label: 'متابعة الإعلانات المشابهة', mode: 'delete' },
  { kind: 'SellerRating', label: 'تقييمات المعلنين', mode: 'delete' },
  { kind: 'UserBlock', label: 'الحظر', mode: 'delete' },
  { kind: 'Report', label: 'بلاغات الإعلانات', mode: 'delete' },
  { kind: 'UserReport', label: 'بلاغات المستخدمين', mode: 'delete' },
  { kind: 'EvidenceCase', label: 'قضايا الأدلة', mode: 'delete' },
  { kind: 'EvidenceAsset', label: 'ملفات الأدلة', mode: 'delete' },
  { kind: 'EvidenceEvent', label: 'سجل الأدلة', mode: 'delete' },
  { kind: 'Commission', label: 'الرسوم والعمولات', mode: 'delete' },
  { kind: 'FollowNotification', label: 'الإشعارات', mode: 'delete' },
  { kind: 'PushSubscription', label: 'اشتراكات إشعارات الويب', mode: 'delete' },
  { kind: 'MobilePushToken', label: 'تسجيلات إشعارات الجوال', mode: 'delete' },
  { kind: 'NotificationDeliveryJob', label: 'مهام إرسال الإشعارات', mode: 'delete' },
  { kind: 'MarketplaceSearchState', label: 'حالة البحث', mode: 'delete' },
  { kind: 'ApiIdempotencyKey', label: 'سجل الطلبات', mode: 'delete' },
  { kind: 'SiteVisitDaily', label: 'إحصاءات الزيارات', mode: 'delete' },
  { kind: 'SiteVisitUnique', label: 'الزيارات الفريدة', mode: 'delete' },
  { kind: 'SiteMessage', label: 'رسائل التطبيق', mode: 'delete' },
  { kind: 'AdminAuditLog', label: 'سجل الإدارة السابق', mode: 'cleanup' },
] as const;

export class MarketResetError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}

export type MarketResetClaim = { actorId: string; asOf: number; fingerprint: string };
function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new MarketResetError('maintenance_not_configured', 503);
  return value;
}
export function signMarketResetPreview(claim: MarketResetClaim) {
  const body = Buffer.from(JSON.stringify({ ...claim, purpose })).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(`${purpose}:${body}`).digest('base64url')}`;
}
export function verifyMarketResetPreview(token: string, actorId: string, now = Date.now()): MarketResetClaim {
  const signingSecret = secret();
  try {
    if (typeof token !== 'string' || token.length > 2000) throw new Error();
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) throw new Error();
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', signingSecret).update(`${purpose}:${body}`).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (claim.purpose !== purpose || claim.actorId !== actorId || !Number.isSafeInteger(claim.asOf) ||
      claim.asOf > now || now - claim.asOf > previewLifetimeMs || !/^[a-f0-9]{64}$/.test(claim.fingerprint)) throw new Error();
    return { actorId: claim.actorId, asOf: claim.asOf, fingerprint: claim.fingerprint };
  } catch { throw new MarketResetError('preview_invalid'); }
}

function assertModelInventory() {
  const expected = new Set<string>(['User', ...marketResetModels.map(model => model.kind)]);
  if (Prisma.dmmf.datamodel.models.length !== expected.size ||
    Prisma.dmmf.datamodel.models.some(model => !expected.has(model.name) || (model.dbName && model.dbName !== model.name))) {
    throw new MarketResetError('reset_schema_changed');
  }
}
const identifier = (kind: string) => Prisma.raw(`"${kind}"`);

async function inspect(tx: Prisma.TransactionClient) {
  assertModelInventory();
  const names = ['User', ...marketResetModels.map(model => model.kind)];
  const tables = await tx.$queryRaw<Array<{ name: string }>>`SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')`;
  if (tables.length !== names.length || tables.some(table => !names.includes(table.name))) {
    throw new MarketResetError('reset_schema_changed');
  }
  const counts = await tx.$queryRaw<Array<{ kind: string; count: bigint }>>(Prisma.join(names.map(kind =>
    Prisma.sql`SELECT ${kind}::text AS kind, count(*)::bigint AS count FROM ${identifier(kind)}`), ' UNION ALL '));
  const byKind = new Map(counts.map(row => [row.kind, Number(row.count)]));
  const totalRows = counts.reduce((sum, row) => sum + Number(row.count), 0);
  const blockers: Array<{ code: string; count: number }> = [];
  if (totalRows > marketResetMaxRows) blockers.push({ code: 'reset_too_large', count: totalRows });
  const [busy] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT (
    (SELECT count(*) FROM "ListingImageUpload" WHERE status='processing' AND "leaseUntil">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) +
    (SELECT count(*) FROM "EvidenceAsset" WHERE status='copying' AND "leaseUntil">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) +
    (SELECT count(*) FROM "ImageObjectCleanup" WHERE "leaseUntil">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND "cleanupAt" IS NULL) +
    (SELECT count(*) FROM "NotificationDeliveryJob" WHERE "leaseUntil">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND "completedAt" IS NULL AND "failedAt" IS NULL)
  )::bigint AS count`;
  if (Number(busy.count)) blockers.push({ code: 'reset_busy', count: Number(busy.count) });
  const [protectedData] = await tx.$queryRaw<Array<{ evidenceCases: bigint; heldEvidenceCases: bigint; commissions: bigint }>>`SELECT
    (SELECT count(*) FROM "EvidenceCase" WHERE status<>'disposed')::bigint AS "evidenceCases",
    (SELECT count(*) FROM "EvidenceCase" WHERE "legalHold"=true)::bigint AS "heldEvidenceCases",
    (SELECT count(*) FROM "Commission")::bigint AS commissions`;
  const profileImages = await tx.user.count({ where: { picture: { not: null } } });
  const accountSecurityRecords = await tx.adminAuditLog.count({ where: accountSecurityAuditWhere });
  const digest = createHash('sha256');
  // No row contents, tokens, private messages or image keys leave this function.
  // Heartbeats do not invalidate a preview; substantive account changes do.
  if (totalRows <= marketResetMaxRows) for (const kind of names) {
    const json = kind === 'User' ? Prisma.sql`to_jsonb(t) - ARRAY['updatedAt','lastActiveAt']::text[]` : Prisma.sql`to_jsonb(t)`;
    const [row] = await tx.$queryRaw<Array<{ hash: string }>>(Prisma.sql`SELECT COALESCE(string_agg(rowhash, '' ORDER BY rowhash),'') AS hash FROM (
      SELECT encode(sha256(convert_to((${json})::text,'UTF8')),'hex') AS rowhash FROM ${identifier(kind)} t
    ) hashes`);
    digest.update(JSON.stringify([kind, byKind.get(kind), row.hash]));
  }
  return {
    fingerprint: digest.digest('hex'), totalRows, blockers,
    counts: marketResetModels.map(model => ({ ...model, count: model.kind === 'AdminAuditLog'
      ? (byKind.get(model.kind) ?? 0) - accountSecurityRecords
      : byKind.get(model.kind) ?? 0 })),
    preserved: { users: byKind.get('User') ?? 0, profileImages, accountSecurityRecords },
    protectedData: Object.fromEntries(Object.entries(protectedData).map(([key, value]) => [key, Number(value)])),
  };
}

export async function getMarketResetPreview(actorId: string) {
  const asOf = Date.now();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    const view = await inspect(tx);
    const { fingerprint, ...preview } = view;
    return { preview: { ...preview, maxRows: marketResetMaxRows, canExecute: !view.blockers.length,
      previewToken: signMarketResetPreview({ actorId, asOf, fingerprint }),
      expiresAt: new Date(asOf + previewLifetimeMs).toISOString() } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000, maxWait: 3000 });
}

type MarketResetInput = {
  actorId: string; reason: string; previewToken: string; confirmation: string;
  backupConfirmed: boolean; includeProtectedData: boolean;
};
export async function executeMarketReset(input: MarketResetInput) {
  if (input.confirmation !== marketResetConfirmation || input.backupConfirmed !== true || input.includeProtectedData !== true ||
    input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new MarketResetError('invalid_reset_request', 400);
  const claim = verifyMarketResetPreview(input.previewToken, input.actorId);
  const operationId = randomUUID();
  return prisma.$transaction(async tx => {
    assertModelInventory();
    await tx.$executeRaw`SET LOCAL statement_timeout = '10000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    // One maintenance owner at a time. Fail rather than waiting behind customer
    // mutations. Table locks also cover routes/workers using other advisory keys.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(771206, 1)`;
    await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.join(marketResetModels.map(model => identifier(model.kind)))} IN EXCLUSIVE MODE NOWAIT`);
    await tx.$executeRaw`LOCK TABLE "User" IN SHARE MODE NOWAIT`;
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { id: true, deletedAt: true } });
    if (!actor || actor.deletedAt) throw new MarketResetError('owner_not_found', 403);
    const current = await inspect(tx);
    if (current.blockers.length) throw new MarketResetError(current.blockers[0].code);
    if (current.fingerprint !== claim.fingerprint) throw new MarketResetError('preview_stale');

    // The owner explicitly acknowledges destruction of evidence and financial
    // records in this separate reset. Normal retention/disposal APIs are unchanged.
    // Use allowed evidence transitions; never disable triggers or truncate tables.
    const assets = await tx.evidenceAsset.findMany({ select: { id: true, caseId: true, objectKey: true, sourceHash: true } });
    for (const asset of assets) await enqueueEvidenceObjectCleanup(tx, asset);
    await tx.evidenceCase.updateMany({ where: { status: { not: 'disposed' } }, data: { status: 'disposing' } });
    const deleted: Record<string, number> = {};
    deleted.EvidenceAsset = (await tx.evidenceAsset.deleteMany()).count;
    deleted.EvidenceEvent = (await tx.evidenceEvent.deleteMany()).count;
    await tx.evidenceCase.updateMany({ where: { status: 'disposing' }, data: {
      snapshot: {}, snapshotHash: '', participantIds: [], conversationIds: [], listingId: null,
      status: 'disposed', captureStatus: 'disposed', disposedAt: new Date(),
    } });
    deleted.EvidenceCase = (await tx.evidenceCase.deleteMany({ where: { status: 'disposed' } })).count;

    const order = ['NotificationDeliveryJob', 'FollowNotification', 'SimilarListingFollow', 'Favorite',
      'UserBlock', 'SellerFollow', 'SellerRating', 'MobilePushToken', 'PushSubscription',
      'ConversationMessage', 'UserReport', 'Report', 'Commission', 'Conversation', 'ListingImage', 'Listing',
      'MarketplaceSearchState', 'ApiIdempotencyKey', 'SiteVisitUnique', 'SiteVisitDaily', 'SiteMessage'];
    for (const kind of order) deleted[kind] = await tx.$executeRaw(Prisma.sql`DELETE FROM ${identifier(kind)}`);
    deleted.AdminAuditLog = (await clearResettableAdminAuditHistory(tx)).count;

    // Listing triggers enqueue public-file deletion and cancel their manifests.
    // Also cancel orphaned manifests, preserving them beyond signed transfer expiry
    // so delayed uploads/worker messages cannot make their objects undiscoverable.
    deleted.ListingImageUpload = (await tx.listingImageUpload.deleteMany({ where: {
      cleanupAt: { not: null }, expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) },
    } })).count;
    await tx.listingImageUpload.updateMany({ data: { status: 'cancelled', errorCode: 'owner_market_reset', cleanupAt: null,
      leaseToken: null, leaseUntil: null } });
    deleted.ImageObjectCleanup = (await tx.imageObjectCleanup.deleteMany({ where: { cleanupAt: { not: null } } })).count;
    const pendingStorageJobs = await tx.imageObjectCleanup.count({ where: { cleanupAt: null } }) +
      await tx.listingImageUpload.count({ where: { cleanupAt: null } });
    await tx.adminAuditLog.create({ data: { id: operationId, adminId: actor.id, action: 'maintenance_cleanup',
      targetType: 'market_reset', targetId: operationId, metadata: {
        operation: purpose, reason: input.reason.trim(), deleted, preservedUsers: current.preserved.users,
        pendingStorageJobs, protectedData: current.protectedData, previewFingerprint: claim.fingerprint,
      } } });
    return { status: 'completed' as const, operationId, deleted, preservedUsers: current.preserved.users, pendingStorageJobs };
  }, { timeout: 30_000, maxWait: 3000 });
}
