import type { Prisma } from '@prisma/client';

type PublicationRecord = {
  id: string;
  status: string;
  updatedAt: string;
  firstPublicationTracked?: boolean;
  firstPublishedAt?: string;
};

export function recordFirstPublication(listing: PublicationRecord, timestamp: string) {
  if (listing.firstPublicationTracked && listing.status === 'published' && !listing.firstPublishedAt) {
    listing.firstPublishedAt = timestamp;
  }
}

export function comparePublicationFeed(left: PublicationRecord, right: PublicationRecord) {
  if (left.firstPublishedAt && right.firstPublishedAt) {
    return right.firstPublishedAt.localeCompare(left.firstPublishedAt) || right.id.localeCompare(left.id);
  }
  if (left.firstPublishedAt) return -1;
  if (right.firstPublishedAt) return 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

export async function recordDatabaseFirstPublication(
  tx: Prisma.TransactionClient,
  listingId: string,
  nextStatus: string,
) {
  if (nextStatus !== 'published') return;
  // The conditional write locks the row and cannot overwrite a concurrent first publish.
  await tx.listing.updateMany({
    where: { id: listingId, firstPublicationTracked: true, firstPublishedAt: null },
    data: { firstPublishedAt: new Date() },
  });
}
