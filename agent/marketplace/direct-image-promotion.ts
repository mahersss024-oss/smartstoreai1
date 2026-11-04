import { randomUUID } from 'node:crypto';
import type { ListingImageUpload, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { DirectImageUploadError } from './direct-image-upload-policy';

export const directImagePromotionBudgetMs = 90_000;
const promotionProtectionMs = directImagePromotionBudgetMs + 60_000;
const receiptPrefix = 'direct-upload:';
const writerPrefix = 'promotion:';
type ReceiptDatabase = Pick<Prisma.TransactionClient, 'imageObjectCleanup' | 'listingImageUpload'>;
type DeliveryUrls = { originalUrl: string; displayUrl: string; thumbnailUrl: string };
export type DirectImagePromotion = { imageId: string; token: string; deadline: number };

export class DirectImagePromotionBusyError extends DirectImageUploadError {
  constructor() { super('image_upload_processing', 409); }
}

export const directImagePromotionReceiptId = (uploadId: string) => `${receiptPrefix}${uploadId}`;
export function directImagePromotionUploadId(imageId: string) {
  return imageId.startsWith(receiptPrefix) ? imageId.slice(receiptPrefix.length) : null;
}

/** Claims cannot replace a worker while its public writer or a cleaner owns fixed keys. */
export async function assertDirectImagePromotionIdle(database: ReceiptDatabase, uploadId: string, now: Date) {
  const receipt = await database.imageObjectCleanup.findUnique({ where: { imageId: directImagePromotionReceiptId(uploadId) } });
  if (receipt && !receipt.cleanupAt && (receipt.attempts !== 0 || (receipt.leaseToken !== null &&
    (!receipt.leaseToken.startsWith(writerPrefix) || !receipt.leaseUntil || receipt.leaseUntil > now)))) {
    throw new DirectImagePromotionBusyError();
  }
}

/** A shared, exclusive writer gate exists durably before any fixed public key is copied. */
export async function reserveDirectImagePromotion(database: ReceiptDatabase, job: ListingImageUpload, urls: DeliveryUrls): Promise<DirectImagePromotion> {
  const now = new Date();
  const deadline = now.getTime() + directImagePromotionBudgetMs;
  const protectedUntil = new Date(now.getTime() + promotionProtectionMs);
  const imageId = directImagePromotionReceiptId(job.id);
  const existing = await database.imageObjectCleanup.findUnique({ where: { imageId } });
  // Never steal a cleaner claim, or a writer still inside its protected budget.
  if (existing && !existing.cleanupAt && (
    existing.attempts !== 0 ||
    (existing.leaseToken !== null && (!existing.leaseToken.startsWith(writerPrefix) || !existing.leaseUntil || existing.leaseUntil > now))
  )) throw new DirectImagePromotionBusyError();
  const token = `${writerPrefix}${randomUUID()}`;
  const data = { urls: [...new Set(Object.values(urls))], ownerId: null, attempts: 0, cleanupAt: null,
    nextAttemptAt: protectedUntil, leaseToken: token, leaseUntil: protectedUntil };
  if (existing) {
    const changed = await database.imageObjectCleanup.updateMany({ where: {
      id: existing.id, leaseToken: existing.leaseToken, cleanupAt: existing.cleanupAt,
      attempts: existing.attempts, updatedAt: existing.updatedAt,
    }, data });
    if (changed.count !== 1) throw new DirectImagePromotionBusyError();
  } else await database.imageObjectCleanup.create({ data: { imageId, ...data } });
  const renewed = await database.listingImageUpload.updateMany({ where: {
    id: job.id, status: 'processing', leaseToken: job.leaseToken,
    leaseUntil: { gt: now }, expiresAt: { gt: now },
  }, data: { leaseUntil: job.leaseUntil && job.leaseUntil > protectedUntil ? job.leaseUntil : protectedUntil } });
  if (renewed.count !== 1) throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
  return { imageId, token, deadline };
}

/** Attach and retiring the writer gate either commit together or both roll back. */
export async function sealDirectImagePromotion(database: ReceiptDatabase, promotion: DirectImagePromotion) {
  const sealed = await database.imageObjectCleanup.deleteMany({ where: {
    imageId: promotion.imageId, leaseToken: promotion.token, attempts: 0, cleanupAt: null,
    leaseUntil: { gt: new Date() },
  } });
  if (sealed.count !== 1) throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
}

/** Only the finished writer can release its token; never reopen an unknown successful attach. */
export async function releaseDirectImagePromotion(promotion: DirectImagePromotion) {
  await prisma.imageObjectCleanup.updateMany({ where: {
    imageId: promotion.imageId, leaseToken: promotion.token, attempts: 0, cleanupAt: null,
  }, data: { leaseToken: null, leaseUntil: null } });
}

/** Both private/source and public deletion wait for every started copy chain to drain. */
export async function directImagePromotionProtectsCleanup(uploadId: string) {
  const receipt = await prisma.imageObjectCleanup.findUnique({ where: { imageId: directImagePromotionReceiptId(uploadId) } });
  const now = new Date();
  return Boolean(receipt && !receipt.cleanupAt && (receipt.nextAttemptAt > now || (receipt.leaseUntil && receipt.leaseUntil > now)));
}
