import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type ReportNotification = {
  id: string;
  sourceType: 'Report' | 'UserReport';
  sourceId: string;
  title: string | null;
  reason: string;
  details: string | null;
  createdAt: Date;
  listingId: string | null;
};

// Existing case events are the shared acknowledgement ledger, not report resolutions.
export async function listReportNotifications(
  page: number,
  limit: number,
  database: PrismaClient = prisma,
) {
  const rows = await database.$queryRaw<ReportNotification[]>`
    SELECT c.id, c."sourceType", c."sourceId", COALESCE(l.title, ul.title) AS title,
      COALESCE(r.reason, u.reason) AS reason, COALESCE(r.details, u.details) AS details,
      COALESCE(r."createdAt", u."createdAt") AS "createdAt", c."listingId"
    FROM "EvidenceCase" c
    LEFT JOIN "Report" r ON c."sourceType" = 'Report' AND r.id = c."sourceId"
    LEFT JOIN "UserReport" u ON c."sourceType" = 'UserReport' AND u.id = c."sourceId" AND u."conversationId" IS NOT NULL
    LEFT JOIN "Listing" l ON l.id = r."listingId"
    LEFT JOIN "Listing" ul ON ul.id = c."listingId"
    WHERE c."disposedAt" IS NULL AND (r.status = 'open' OR u.status = 'open')
      AND NOT EXISTS (SELECT 1 FROM "EvidenceEvent" e WHERE e."caseId" = c.id AND e.action = 'notification.viewed')
    ORDER BY COALESCE(r."createdAt", u."createdAt") DESC, c.id DESC
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
