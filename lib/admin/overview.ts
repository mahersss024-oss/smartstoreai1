import type { PrismaClient } from '@prisma/client';

import { authenticatedUserActiveWindowMs } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { getAppUsageStats } from '@/lib/analytics/site-visits';

type OverviewDatabase = Pick<PrismaClient, 'user' | 'listing' | 'report' | 'userReport' | '$queryRaw'>;

export async function getAdminOverview(
  now = new Date(),
  database: OverviewDatabase = prisma,
) {
  const activeSince = new Date(now.getTime() - authenticatedUserActiveWindowMs);
  const [totalUsers, activeUsers, publishedListings, listingReports, conversationReports, appUsage] =
    await Promise.all([
      database.user.count({ where: { deletedAt: null } }),
      database.user.count({
        where: { deletedAt: null, lastActiveAt: { gte: activeSince } },
      }),
      database.listing.count({ where: { status: 'published' } }),
      database.report.count({ where: { status: 'open' } }),
      database.userReport.count({
        where: { status: 'open', conversationId: { not: null } },
      }),
      getAppUsageStats(now, database),
    ]);

  return {
    totalUsers,
    activeUsers,
    publishedListings,
    openReports: listingReports + conversationReports,
    appUsage,
  };
}
