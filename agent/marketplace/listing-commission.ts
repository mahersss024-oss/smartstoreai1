import type { Prisma } from '@prisma/client';

/** Keep customer and administrative sale transitions on the same financial contract. */
export async function ensureDatabaseSaleCommission(
  tx: Prisma.TransactionClient,
  listing: { id: string; sellerId: string; status: string },
) {
  if (listing.status !== 'sold') return;
  // A sale needs the seller's actual final amount. Never infer it from the ad
  // price or overwrite a settlement already approved by an administrator.
  await tx.commission.upsert({
    where: { listingId: listing.id },
    create: {
      listingId: listing.id,
      sellerId: listing.sellerId,
      productValue: null,
      commissionRatePercent: 1,
      commissionAmount: null,
      status: 'pending_amount',
    },
    update: {},
  });
}
