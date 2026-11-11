import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

const listingViewReceiptNamespace = 'listing_view';
const listingViewReceiptTtlMs = 7 * 24 * 60 * 60_000;
const listingViewReceiptCleanupInterval = 256;
let listingViewReceiptWrites = 0;

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

class ListingIsNoLongerPublicError extends Error {}

/**
 * Add one view for an explicit screen-open ID. Repeated React Query refetches,
 * retries, or concurrent duplicate requests share the same receipt and count
 * only once. Receipts are pruned opportunistically to keep the existing
 * idempotency table bounded without requiring a schema change or cron job.
 */
export async function recordPublicListingView(
  listingId: string,
  visitId: string,
  database: Pick<PrismaClient, '$transaction'> = prisma,
) {
  const key = createHash('sha256').update(visitId).digest('hex');
  const pruneReceipts = ++listingViewReceiptWrites % listingViewReceiptCleanupInterval === 0;
  const receiptCutoff = new Date(Date.now() - listingViewReceiptTtlMs);

  try {
    return await database.$transaction(async (tx) => {
      await tx.apiIdempotencyKey.create({
        data: { namespace: listingViewReceiptNamespace, actorKey: listingId, key },
      });
      const rows = await tx.$queryRaw<Array<{ views: number }>>`
        UPDATE "Listing" AS l
        SET "views" = l."views" + 1
        FROM "User" AS u
        WHERE l."id" = ${listingId}
          AND l."status" = 'published'
          AND u."id" = l."sellerId"
          AND u."deletedAt" IS NULL
        RETURNING l."views" AS views
      `;

      if (!rows.length) throw new ListingIsNoLongerPublicError();

      await tx.apiIdempotencyKey.update({
        where: {
          namespace_actorKey_key: {
            namespace: listingViewReceiptNamespace,
            actorKey: listingId,
            key,
          },
        },
        data: { status: 'completed', statusCode: 204 },
      });

      if (pruneReceipts) {
        await tx.apiIdempotencyKey.deleteMany({
          where: {
            namespace: listingViewReceiptNamespace,
            createdAt: { lt: receiptCutoff },
            status: 'completed',
          },
        });
      }

      return rows[0].views;
    });
  } catch (error) {
    if (isUniqueConstraintError(error) || error instanceof ListingIsNoLongerPublicError) return null;
    throw error;
  }
}
