import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { enqueueImageObjectCleanup } from '@/agent/marketplace/image-object-cleanup';

export const maintenanceScopes = ['closed_reports', 'closed_user_reports', 'search_state', 'purge_deleted_listings', 'old_model_reviews'] as const;
export type MaintenanceScope = typeof maintenanceScopes[number];
export const maintenanceBatchSize = 50;
const previewLifetimeMs = 10 * 60_000;
const day = 86_400_000;
const labels: Record<MaintenanceScope, string> = {
  closed_reports: 'بلاغات الإعلانات المغلقة', closed_user_reports: 'بلاغات العملاء المغلقة',
  search_state: 'البحث والطلبات المكتملة القديمة', purge_deleted_listings: 'الإعلانات المحذوفة', old_model_reviews: 'ملاحظات النماذج القديمة',
};
type Candidate = { id: string; kind: string; fingerprint: string; blocked: string | null; entityKeys: string[] };
type Totals = { total: bigint; eligible: bigint; protected: bigint };
export class MaintenanceError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
function source(scope: MaintenanceScope, asOf: Date): Prisma.Sql {
  if (scope === 'closed_reports' || scope === 'closed_user_reports') {
    const report = scope === 'closed_reports';
    const table = report ? Prisma.sql`"Report"` : Prisma.sql`"UserReport"`;
    const kind = report ? 'Report' : 'UserReport';
    const cutoff = new Date(asOf.getTime() - 180 * day);
    return Prisma.sql`SELECT r.id, ${kind}::text AS kind, md5(to_jsonb(r)::text) AS fingerprint,
      CASE WHEN EXISTS(SELECT 1 FROM "EvidenceCase" e WHERE e."sourceType"=${kind} AND e."sourceId"=r.id AND e.status<>'disposed') THEN 'evidence'
        WHEN r."updatedAt">=${cutoff} THEN 'retention' ELSE NULL END AS blocked,
      ARRAY[]::text[] AS "entityKeys" FROM ${table} r WHERE r.status IN ('reviewed','dismissed')`;
  }
  if (scope === 'search_state') {
    const cutoff = new Date(asOf.getTime() - day);
    return Prisma.sql`SELECT s.id, 'MarketplaceSearchState'::text AS kind, md5(to_jsonb(s)::text) AS fingerprint,
      CASE WHEN s."updatedAt">=${cutoff} THEN 'recent' ELSE NULL END AS blocked, ARRAY[]::text[] AS "entityKeys" FROM "MarketplaceSearchState" s
      UNION ALL SELECT k.id, 'ApiIdempotencyKey'::text, md5(to_jsonb(k)::text),
      CASE WHEN k.status<>'completed' THEN 'request_in_progress' WHEN k."updatedAt">=${cutoff} THEN 'recent' ELSE NULL END, ARRAY[]::text[] FROM "ApiIdempotencyKey" k`;
  }
  if (scope === 'old_model_reviews') {
    const cutoff = new Date(asOf.getTime() - 30 * day);
    return Prisma.sql`SELECT a.id, 'AdminAuditLog'::text AS kind, md5(to_jsonb(a)::text) AS fingerprint,
      CASE WHEN a."createdAt">=${cutoff} THEN 'recent' ELSE NULL END AS blocked, ARRAY[]::text[] AS "entityKeys"
      FROM "AdminAuditLog" a WHERE a."targetType"='ModelReview' AND a."adminId" IS NULL`;
  }
  const deletedListingCutoff = new Date(asOf.getTime() - 30 * day);
  const closedReportCutoff = new Date(asOf.getTime() - 180 * day);
  return Prisma.sql`SELECT l.id, 'Listing'::text AS kind, md5(to_jsonb(l)::text ||
      COALESCE((SELECT string_agg(md5(to_jsonb(i)::text), '' ORDER BY i.id) FROM "ListingImage" i WHERE i."listingId"=l.id),'') ||
      COALESCE((SELECT string_agg(md5(to_jsonb(c)::text), '' ORDER BY c.id) FROM "Conversation" c WHERE c."listingId"=l.id),'')) AS fingerprint,
    CASE WHEN EXISTS(SELECT 1 FROM "EvidenceCase" e WHERE e."listingId"=l.id AND e.status<>'disposed') THEN 'evidence'
      WHEN EXISTS(SELECT 1 FROM "Commission" c WHERE c."listingId"=l.id) THEN 'commission'
      WHEN l."updatedAt">=${deletedListingCutoff} THEN 'retention'
      WHEN EXISTS(SELECT 1 FROM "Report" r WHERE r."listingId"=l.id AND r.status='open') THEN 'open_report'
      WHEN EXISTS(SELECT 1 FROM "Report" r WHERE r."listingId"=l.id AND r.status IN ('reviewed','dismissed') AND r."updatedAt">=${closedReportCutoff}) THEN 'report_retention'
      WHEN EXISTS(SELECT 1 FROM "UserReport" ur JOIN "Conversation" uc ON uc.id=ur."conversationId" WHERE uc."listingId"=l.id AND ur.status='open') THEN 'open_user_report'
      WHEN EXISTS(SELECT 1 FROM "UserReport" ur JOIN "Conversation" uc ON uc.id=ur."conversationId" WHERE uc."listingId"=l.id AND ur.status IN ('reviewed','dismissed') AND ur."updatedAt">=${closedReportCutoff}) THEN 'report_retention'
      WHEN EXISTS(SELECT 1 FROM "Conversation" c WHERE c."listingId"=l.id AND c.status='open') THEN 'active_conversation'
      WHEN EXISTS(SELECT 1 FROM "ListingImageUpload" u WHERE u."listingId"=l.id AND u.status IN ('pending','processing')) THEN 'upload_in_progress'
      WHEN (SELECT count(*) FROM (SELECT m.id FROM "ConversationMessage" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE c."listingId"=l.id LIMIT 501) bounded)>500 THEN 'related_rows_limit'
      ELSE NULL END AS blocked, ARRAY['listing:' || l.id, 'user:' || l."sellerId"] AS "entityKeys"
    FROM "Listing" l WHERE l.status='deleted'`;
}
async function inspect(tx: Prisma.TransactionClient, scope: MaintenanceScope, asOf: Date) {
  const query = source(scope, asOf);
  const [totals] = await tx.$queryRaw<Totals[]>(Prisma.sql`WITH candidates AS (${query}) SELECT count(*) AS total, count(*) FILTER (WHERE blocked IS NULL) AS eligible, count(*) FILTER (WHERE blocked IS NOT NULL) AS protected FROM candidates`);
  const rows = await tx.$queryRaw<Candidate[]>(Prisma.sql`WITH candidates AS (${query}) SELECT * FROM candidates WHERE blocked IS NULL ORDER BY kind,id LIMIT ${maintenanceBatchSize}`);
  const reasons = await tx.$queryRaw<Array<{ reason: string; count: bigint }>>(Prisma.sql`WITH candidates AS (${query}) SELECT blocked AS reason,count(*) AS count FROM candidates WHERE blocked IS NOT NULL GROUP BY blocked ORDER BY blocked`);
  const counts = { total: Number(totals.total), eligible: Number(totals.eligible), protected: Number(totals.protected) };
  const reasonCounts = Object.fromEntries(reasons.map(row => [row.reason, Number(row.count)]));
  const fingerprint = createHash('sha256').update(JSON.stringify({ counts, reasonCounts, rows })).digest('hex');
  return { ...counts, reasonCounts, rows, fingerprint };
}
function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new MaintenanceError('maintenance_not_configured', 503);
  return value;
}
type PreviewClaim = { actorId: string; scope: MaintenanceScope; asOf: number; fingerprint: string };
export function signMaintenancePreview(claim: PreviewClaim) {
  const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
export function verifyMaintenancePreview(token: string, actorId: string, scope: MaintenanceScope, now = Date.now()): PreviewClaim {
  try {
    if (token.length > 2000) throw new Error();
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) throw new Error();
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', secret()).update(body).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PreviewClaim;
    if (claim.actorId !== actorId || claim.scope !== scope || !Number.isSafeInteger(claim.asOf) || claim.asOf > now || now-claim.asOf>previewLifetimeMs || !/^[a-f0-9]{64}$/.test(claim.fingerprint)) throw new Error();
    return claim;
  } catch { throw new MaintenanceError('preview_invalid', 409); }
}
export async function getMaintenancePreview(actorId: string, selected?: MaintenanceScope) {
  const asOf = new Date();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '6000ms'`;
    const scopes = [];
    for (const scope of selected ? [selected] : maintenanceScopes) {
      const view = await inspect(tx, scope, asOf);
      scopes.push({ scope, label: labels[scope], total: view.total, eligible: view.eligible, protected: view.protected,
        reasonCounts: view.reasonCounts, batchCount: view.rows.length,
        affectedIds: view.rows.map(row => ({ id: row.id, kind: row.kind })),
        previewToken: signMaintenancePreview({ actorId, scope, asOf: asOf.getTime(), fingerprint: view.fingerprint }),
        expiresAt: new Date(asOf.getTime()+previewLifetimeMs).toISOString() });
    }
    const [deletedListings, deletedListingImages, closedReports, closedUserReports, searchStates, idempotencyKeys, modelReviews] = await Promise.all([
      tx.listing.count({ where: { status: 'deleted' } }), tx.listingImage.count({ where: { listing: { status: 'deleted' } } }),
      tx.report.count({ where: { status: { in: ['reviewed','dismissed'] } } }), tx.userReport.count({ where: { status: { in: ['reviewed','dismissed'] } } }),
      tx.marketplaceSearchState.count(), tx.apiIdempotencyKey.count(), tx.adminAuditLog.count({ where: { targetType: 'ModelReview', adminId: null } }),
    ]);
    return { counts: { deletedListings, deletedListingImages, closedReports, closedUserReports, searchStates, idempotencyKeys, modelReviews }, scopes, productionCleanupEnabled: true, maxBatchSize: maintenanceBatchSize };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000, maxWait: 3000 });
}
export async function executeMaintenanceCleanup(input: { actorId: string; scope: MaintenanceScope; reason: string; previewToken: string }) {
  const claim = verifyMaintenancePreview(input.previewToken, input.actorId, input.scope);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '6000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(771206, 1)`;
    const initial = await inspect(tx, input.scope, new Date(claim.asOf));
    const keys = new Set(initial.rows.flatMap(row => row.entityKeys));
    if (input.scope === 'closed_reports' || input.scope === 'closed_user_reports') {
      const ids = initial.rows.map(row => row.id);
      const cases = await tx.evidenceCase.findMany({ where: { sourceType: input.scope === 'closed_reports' ? 'Report' : 'UserReport', sourceId: { in: ids } }, select: { listingId: true, participantIds: true } });
      for (const row of cases) { for (const id of row.participantIds) keys.add(`user:${id}`); if (row.listingId) keys.add(`listing:${row.listingId}`); }
    }
    for (const key of [...keys].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(771204, hashtext(${key}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(771203, 1)`;
    for (const row of initial.rows) {
      const tables: Record<string, Prisma.Sql> = { Report: Prisma.sql`"Report"`, UserReport: Prisma.sql`"UserReport"`, Listing: Prisma.sql`"Listing"`, MarketplaceSearchState: Prisma.sql`"MarketplaceSearchState"`, ApiIdempotencyKey: Prisma.sql`"ApiIdempotencyKey"`, AdminAuditLog: Prisma.sql`"AdminAuditLog"` };
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ${tables[row.kind]} WHERE id=${row.id} FOR UPDATE`);
    }
    const current = await inspect(tx, input.scope, new Date(claim.asOf));
    if (current.fingerprint !== claim.fingerprint) throw new MaintenanceError('preview_stale');
    const ids = current.rows.map(row => row.id);
    if (!ids.length) throw new MaintenanceError('cleanup_empty');
    const deleted: Record<string, number> = {};
    if (input.scope === 'closed_reports') deleted.closedReports = (await tx.report.deleteMany({ where: { id: { in: ids }, status: { in: ['reviewed','dismissed'] } } })).count;
    else if (input.scope === 'closed_user_reports') deleted.closedUserReports = (await tx.userReport.deleteMany({ where: { id: { in: ids }, status: { in: ['reviewed','dismissed'] } } })).count;
    else if (input.scope === 'purge_deleted_listings') {
      const images = await tx.listingImage.findMany({
        where: { listingId: { in: ids } },
        select: { id: true, originalUrl: true, displayUrl: true, thumbnailUrl: true },
      });
      for (const image of images) {
        await enqueueImageObjectCleanup(tx, {
          imageId: image.id,
          urls: [image.originalUrl, image.displayUrl, image.thumbnailUrl],
        });
      }
      deleted.listings = (await tx.listing.deleteMany({ where: { id: { in: ids }, status: 'deleted' } })).count;
      deleted.imagesQueuedForStorageCleanup = images.length;
    }
    else if (input.scope === 'search_state') {
      deleted.searchStates = (await tx.marketplaceSearchState.deleteMany({ where: { id: { in: current.rows.filter(r => r.kind === 'MarketplaceSearchState').map(r=>r.id) } } })).count;
      deleted.idempotencyKeys = (await tx.apiIdempotencyKey.deleteMany({ where: { id: { in: current.rows.filter(r => r.kind === 'ApiIdempotencyKey').map(r=>r.id) }, status: 'completed' } })).count;
    } else {
      deleted.modelReviews = (await tx.adminAuditLog.deleteMany({ where: { id: { in: ids }, targetType: 'ModelReview', adminId: null } })).count;
    }
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { id: true } });
    await tx.adminAuditLog.create({ data: { adminId: actor?.id ?? null, action: 'maintenance_cleanup', targetType: 'maintenance', targetId: input.scope,
      metadata: { operation: 'owner_bounded_cleanup', reason: input.reason, affected: current.rows.map(row => ({ id: row.id, kind: row.kind })), fingerprint: claim.fingerprint, deleted } } });
    return { deleted, affectedIds: ids };
  }, { timeout: 20_000, maxWait: 3000 });
}
