import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSaudiDay } from '@/lib/analytics/site-visits';

type WorkspaceDatabase = Pick<
  PrismaClient,
  'listing' | 'commission' | 'evidenceCase' | 'siteVisitDaily' | 'siteMessage'
>;

export function workspaceMonth(value: string | null, now = new Date()) {
  const month = value ?? getSaudiDay(now).slice(0, 7);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(`${month}-01T00:00:00.000+03:00`);
  const end = new Date(Date.UTC(year, monthNumber, 1, -3));
  return { month, start, end };
}

export async function getAdminWorkspace(
  range: NonNullable<ReturnType<typeof workspaceMonth>>,
  database: WorkspaceDatabase = prisma,
) {
  const [listings, commissions, evidence, visits, retention, siteMessage] =
    await Promise.all([
      database.listing.groupBy({ by: ['status'], _count: { _all: true } }),
      database.commission.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { commissionAmount: true },
      }),
      database.evidenceCase.groupBy({
        by: ['captureStatus'],
        where: { disposedAt: null },
        _count: { _all: true },
      }),
      database.siteVisitDaily.findMany({
        where: {
          day: { gte: range.month + '-01', lt: getSaudiDay(range.end) },
        },
        orderBy: { day: 'asc' },
        select: { day: true, visits: true, uniqueVisitors: true },
      }),
      database.evidenceCase.findMany({
        where: {
          disposedAt: null,
          retainUntil: { gte: range.start, lt: range.end },
        },
        orderBy: [{ retainUntil: 'asc' }, { id: 'asc' }],
        take: 101,
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          retainUntil: true,
          legalHold: true,
        },
      }),
      database.siteMessage.findUnique({
        where: { id: 'primary' },
        select: { isEnabled: true, expiresAt: true },
      }),
    ]);
  // Retention dates are review points, never instructions to dispose evidence.
  const events = retention.slice(0, 100).map((row) => ({
    id: row.id,
    title: row.legalHold
      ? 'مراجعة احتفاظ بالأدلة · الإتلاف معلّق'
      : 'مراجعة مدة الاحتفاظ بالأدلة',
    date: getSaudiDay(row.retainUntil!),
    href: '/admin/moderation',
  }));
  if (
    siteMessage?.isEnabled &&
    siteMessage.expiresAt &&
    siteMessage.expiresAt >= range.start &&
    siteMessage.expiresAt < range.end
  ) {
    events.push({
      id: 'site-message-expiry',
      title: 'انتهاء رسالة الموقع',
      date: getSaudiDay(siteMessage.expiresAt),
      href: '/admin/maintenance',
    });
  }
  return {
    month: range.month,
    listings: listings.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    commissions: commissions.map((row) => ({
      status: row.status,
      count: row._count._all,
      amount: row._sum.commissionAmount?.toString() ?? '0',
    })),
    evidence: evidence.map((row) => ({
      status: row.captureStatus,
      count: row._count._all,
    })),
    visits,
    events,
    hasMoreEvents: retention.length > 100,
  };
}

export type AdminWorkspace = Awaited<ReturnType<typeof getAdminWorkspace>>;
