import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const maintenanceScopes = ['closed_reports', 'closed_user_reports', 'search_state', 'purge_deleted_listings', 'old_model_reviews'] as const;
export type MaintenanceScope = typeof maintenanceScopes[number];
export class MaintenanceError extends Error {
  constructor(public code: string, public status = 403) { super(code); }
}

/** Counts only. This transaction cannot delete or update marketplace records. */
export async function getMaintenanceOverview() {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '6000ms'`;
    const [deletedListings, deletedListingImages, closedReports, closedUserReports, searchStates, idempotencyKeys, modelReviews] = await Promise.all([
      tx.listing.count({ where: { status: 'deleted' } }), tx.listingImage.count({ where: { listing: { status: 'deleted' } } }),
      tx.report.count({ where: { status: { in: ['reviewed','dismissed'] } } }), tx.userReport.count({ where: { status: { in: ['reviewed','dismissed'] } } }),
      tx.marketplaceSearchState.count(), tx.apiIdempotencyKey.count(), tx.adminAuditLog.count({ where: { targetType: 'ModelReview', adminId: null } }),
    ]);
    return { counts: { deletedListings, deletedListingImages, closedReports, closedUserReports, searchStates, idempotencyKeys, modelReviews },
      scopes: [], monitoringOnly: true, productionCleanupEnabled: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000, maxWait: 3000 });
}

/** Legacy imports cannot create executable cleanup previews or enable cleanup. */
export async function getMaintenancePreview(actorId: string, selected?: MaintenanceScope) {
  void actorId; void selected;
  return getMaintenanceOverview();
}
export async function executeMaintenanceCleanup(input: { actorId: string; scope: MaintenanceScope; reason: string; previewToken: string }): Promise<never> {
  void input;
  throw new MaintenanceError('maintenance_read_only', 403);
}
