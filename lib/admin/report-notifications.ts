import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type ReportNotification = {
  id: string;
  sourceType: 'Report' | 'UserReport' | 'ModelReview';
  sourceId: string;
  title: string | null;
  reason: string;
  details: string | null;
  createdAt: Date;
  listingId: string | null;
  subjectUserId?: string | null;
};

// Existing case events are the shared acknowledgement ledger, not report resolutions.
export async function listReportNotifications(
  page: number,
  limit: number,
  database: PrismaClient = prisma,
) {
  const rows = await database.$queryRaw<ReportNotification[]>`
    SELECT * FROM (
    SELECT c.id, c."sourceType", c."sourceId", COALESCE(l.title, ul.title) AS title,
      COALESCE(r.reason, u.reason) AS reason, COALESCE(r.details, u.details) AS details,
      COALESCE(r."createdAt", u."createdAt") AS "createdAt", c."listingId", NULL::text AS "subjectUserId"
    FROM "EvidenceCase" c
    LEFT JOIN "Report" r ON c."sourceType" = 'Report' AND r.id = c."sourceId"
    LEFT JOIN "UserReport" u ON c."sourceType" = 'UserReport' AND u.id = c."sourceId" AND u."conversationId" IS NOT NULL
    LEFT JOIN "Listing" l ON l.id = r."listingId"
    LEFT JOIN "Listing" ul ON ul.id = c."listingId"
    WHERE c."disposedAt" IS NULL AND (r.status = 'open' OR u.status = 'open')
      AND NOT EXISTS (SELECT 1 FROM "EvidenceEvent" e WHERE e."caseId" = c.id AND e.action = 'notification.viewed')
    UNION ALL
    SELECT a.id, 'ModelReview' AS "sourceType", a.id AS "sourceId",
      CASE a.metadata->>'subject' WHEN 'message' THEN 'مراجعة رسالة' WHEN 'image' THEN 'مراجعة صورة' ELSE 'مراجعة إعلان' END AS title,
      'ملاحظة آلية تحتاج مراجعة الإدارة' AS reason, a.metadata->>'contentText' AS details,
      a."createdAt", a.metadata->>'listingId' AS "listingId", a.metadata->>'userId' AS "subjectUserId"
    FROM "AdminAuditLog" a
    WHERE a."targetType" = 'ModelReview' AND a."adminId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "AdminAuditLog" viewed WHERE viewed."targetType" = 'ModelReviewRead' AND viewed."targetId" = a.id)
    ) inbox ORDER BY "createdAt" DESC, id DESC
    LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}
  `;
  return {
    notifications: rows.slice(0, limit),
    page,
    hasMore: rows.length > limit,
  };
}

export async function acknowledgeReportNotification(
  caseId: string,
  actorId: string,
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (tx) => {
    if (caseId.startsWith('model-review-')) {
      const review = await tx.adminAuditLog.findUnique({ where: { id: caseId }, select: { targetType: true, adminId: true } });
      if (review?.targetType !== 'ModelReview' || review.adminId !== null) return false;
      await tx.adminAuditLog.createMany({ data: [{ id: `${caseId}.read`, adminId: actorId, action: 'review_report', targetType: 'ModelReviewRead', targetId: caseId, metadata: { scope: 'shared' } }], skipDuplicates: true });
      return true;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(771205, hashtext(${caseId}))`;
    const evidenceCase = await tx.evidenceCase.findUnique({
      where: { id: caseId },
      select: { id: true, sourceType: true, sourceId: true, disposedAt: true },
    });
    if (!evidenceCase || evidenceCase.disposedAt) return false;
    const report =
      evidenceCase.sourceType === 'Report'
        ? await tx.report.findUnique({
            where: { id: evidenceCase.sourceId },
            select: { id: true },
          })
        : evidenceCase.sourceType === 'UserReport'
          ? await tx.userReport.findFirst({
              where: {
                id: evidenceCase.sourceId,
                conversationId: { not: null },
              },
              select: { id: true },
            })
          : null;
    if (!report) return false;
    const viewed = await tx.evidenceEvent.findFirst({
      where: { caseId, action: 'notification.viewed' },
      select: { id: true },
    });
    if (!viewed)
      await tx.evidenceEvent.create({
        data: {
          caseId,
          actorId,
          action: 'notification.viewed',
          payload: { scope: 'shared' },
        },
      });
    return true;
  });
}
