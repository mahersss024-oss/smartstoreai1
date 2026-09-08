import { getSiteVisitStats } from '@/lib/analytics/site-visits';
import { getAuthSession, isAdminSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

function decimalToNumber(value: unknown) {
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }

  return typeof value === 'number' ? value : 0;
}

function toCountMap<T extends string>(
  groups: Array<{ status: T; _count: { _all: number } }>,
) {
  return Object.fromEntries(
    groups.map((group) => [group.status, group._count._all]),
  ) as Record<T, number>;
}

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const [
    users,
    listings,
    images,
    conversations,
    messages,
    favorites,
    reports,
    commissions,
    listingStatuses,
    imageStatuses,
    reportStatuses,
    commissionStatuses,
    dueCommissionTotal,
    paidCommissionTotal,
    adminActions,
    visits,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.listingImage.count(),
    prisma.conversation.count(),
    prisma.conversationMessage.count(),
    prisma.favorite.count(),
    prisma.report.count(),
    prisma.commission.count(),
    prisma.listing.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.listingImage.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.report.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.commission.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.commission.aggregate({
      where: { status: 'due' },
      _sum: { commissionAmount: true },
    }),
    prisma.commission.aggregate({
      where: { status: 'paid' },
      _sum: { commissionAmount: true },
    }),
    prisma.adminAuditLog.count(),
    getSiteVisitStats(),
  ]);

  return Response.json({
    totals: {
      users,
      listings,
      images,
      conversations,
      messages,
      favorites,
      reports,
      commissions,
      adminActions,
    },
    statuses: {
      listings: toCountMap(listingStatuses),
      images: toCountMap(imageStatuses),
      reports: toCountMap(reportStatuses),
      commissions: toCountMap(commissionStatuses),
    },
    money: {
      dueCommissions: decimalToNumber(dueCommissionTotal._sum.commissionAmount),
      paidCommissions: decimalToNumber(paidCommissionTotal._sum.commissionAmount),
    },
    visits,
  });
}
