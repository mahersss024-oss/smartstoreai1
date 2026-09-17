import { prisma } from '@/lib/db/prisma';
import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function toCountMap<T extends string>(
  groups: Array<{ status: T; _count: { _all: number } }>,
) {
  return Object.fromEntries(
    groups.map((group) => [group.status, group._count._all]),
  ) as Record<T, number>;
}

/**
 * Scoped overview for appointed moderators. Exposes only the metrics a
 * moderator is allowed to see (content review + reports) and never leaks
 * owner/admin-only data such as finances, accounts or maintenance stats.
 */
export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const [
    listings,
    images,
    reports,
    openListingReports,
    openUserReports,
    listingStatuses,
    imageStatuses,
    reportStatuses,
  ] = await Promise.all([
    prisma.listing.count(),
    prisma.listingImage.count(),
    prisma.report.count(),
    prisma.report.count({ where: { status: 'open' } }),
    prisma.userReport.count({ where: { status: 'open' } }),
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
  ]);

  return Response.json(
    {
      totals: {
        listings,
        images,
        reports,
        openReports: openListingReports + openUserReports,
        openListingReports,
        openUserReports,
      },
      statuses: {
        listings: toCountMap(listingStatuses),
        images: toCountMap(imageStatuses),
        reports: toCountMap(reportStatuses),
      },
    },
    {
      headers: noStoreHeaders,
    },
  );
}
