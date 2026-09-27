import type { PrismaClient } from '@prisma/client';

import { authenticatedUserActiveWindowMs } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

type OverviewDatabase = Pick<PrismaClient, 'user' | 'listing' | 'report' | 'userReport'>;

export async function getAdminOverview(
  now = new Date(),
  database: OverviewDatabase = prisma,
) {
  const activeSince = new Date(now.getTime() - authenticatedUserActiveWindowMs);
  const [totalUsers, activeUsers, publishedListings, listingReports, conversationReports] =
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
    ]);

  return {
    totalUsers,
    activeUsers,
    publishedListings,
    openReports: listingReports + conversationReports,
  };
}
