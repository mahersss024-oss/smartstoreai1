import { randomUUID } from 'node:crypto';
import { Prisma, type ListingImageUpload } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import { after } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import { incrementRuntimeCounter } from '@/lib/observability/runtime-metrics';
import { analyzeImageQuality } from './image-quality';
import { reviewListingImageContent } from './listing-image-content';
import { getMaxListingImagesPerListing } from './listing-image-limits';
import { scheduleListingEvidenceCopy } from './evidence';
import {
  createDirectImageTransfer, discardDirectImageObjects, getDirectImageUploadConfiguration,
  promoteProcessedImages, readProcessedImage, getDirectImageVariantMediaType,
} from './direct-image-objects';
import {
  activeImageUploadStatuses, DirectImageUploadError, directImageUploadsEnabled,
  directImageUploadLeaseMs, directImageUploadLifetimeMs, directImageUploadMaxAttempts,
  imageUploadFingerprint, imageUploadObjectKeys, imageUploadTargetAllowed, isImageUploadActive,
} from './direct-image-upload-policy';

export const directImageUploadInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mediaType: z.literal('image/jpeg'),
  sizeBytes: z.number().int().positive().max(12 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).transform(value => value.toLowerCase()),
}).strict();

// Explicit effect seams allow isolated lifecycle tests without production I/O.
export const directImageUploadEffects = {
  createTransfer: createDirectImageTransfer,
  readImage: readProcessedImage,
  promote: promoteProcessedImages,
  discard: discardDirectImageObjects,
  review: reviewListingImageContent,
  now: () => Date.now(),
};

async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (!['P2034', 'P2002'].includes(String(code)) || attempt >= 8) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1) + Math.floor(Math.random() * 50)));
    }
  }
}

export function imageUploadSummary(job: ListingImageUpload) {
  return {
    id: job.id, status: job.status, expiresAt: job.expiresAt.toISOString(),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
  };
}

function requireConfiguration() {
  if (!directImageUploadsEnabled() || !getDirectImageUploadConfiguration()) {
    throw new DirectImageUploadError('direct_image_uploads_unavailable', 503);
  }
}

const activeWhere = (now: Date) => ({ status: { in: [...activeImageUploadStatuses] }, expiresAt: { gt: now } });

async function expireJobs(tx: Prisma.TransactionClient, listingId: string, now: Date) {
  await tx.listingImageUpload.updateMany({
    where: { listingId, status: { in: [...activeImageUploadStatuses] }, expiresAt: { lte: now } },
    data: { status: 'expired', errorCode: 'image_upload_expired', leaseToken: null, leaseUntil: null },
  });
}

async function ownedTarget(tx: Prisma.TransactionClient, listingId: string, sellerId: string) {
  const listing = await tx.listing.findUnique({ where: { id: listingId }, include: { images: true } });
  const seller = await tx.user.findUnique({ where: { id: sellerId }, select: { deletedAt: true } });
  return { listing, allowed: imageUploadTargetAllowed(listing, sellerId, seller) };
}

export async function createDirectImageUpload(listingId: string, sellerId: string, key: string, input: z.infer<typeof directImageUploadInput>) {
  requireConfiguration();
  const fingerprint = imageUploadFingerprint(input);
  const job = await serializable(async tx => {
    const now = new Date();
    const { listing, allowed } = await ownedTarget(tx, listingId, sellerId);
    if (!allowed || !listing) throw new DirectImageUploadError('listing_not_found', 404);
    await expireJobs(tx, listingId, now);
    const previous = await tx.listingImageUpload.findUnique({ where: { sellerId_listingId_idempotencyKey: { sellerId, listingId, idempotencyKey: key } } });
    if (previous) {
      if (previous.requestFingerprint !== fingerprint) throw new DirectImageUploadError('idempotency_payload_mismatch', 409);
      return previous;
    }
    const reserved = await tx.listingImageUpload.count({ where: { listingId, ...activeWhere(now) } });
    if (listing.images.length + reserved >= getMaxListingImagesPerListing()) {
      throw new DirectImageUploadError('listing_image_limit_reached', 409);
    }
    const id = randomUUID();
    return tx.listingImageUpload.create({ data: {
      id, listingId, sellerId, idempotencyKey: key, requestFingerprint: fingerprint,
      ...input, ...imageUploadObjectKeys(id), expiresAt: new Date(now.getTime() + directImageUploadLifetimeMs),
    } });
  });
  return {
    upload: imageUploadSummary(job),
    ...(job.status === 'pending' && job.expiresAt > new Date() ? { transfer: await directImageUploadEffects.createTransfer(job) } : {}),
  };
}

async function safeDiscard(job: ListingImageUpload, includePublic = false) {
  try {
    const current = await prisma.listingImageUpload.findUnique({ where: { id: job.id } });
    // A late completion must not remove the shared raw source or public copies
    // being used by a newer lease. A lease mismatch is not a terminal state.
    if (current && ['pending', 'processing'].includes(current.status)) return false;
    includePublic = includePublic || (current?.status ?? job.status) !== 'ready';
    // A disconnected transaction can have committed. Never remove an attached
    // image just because its acknowledgement was lost.
    if (includePublic && await prisma.listingImage.findUnique({ where: { id: job.id }, select: { id: true } })) includePublic = false;
    const completed = await directImageUploadEffects.discard(job, { includePublic });
    if (completed === false) return false;
    const marked = await prisma.listingImageUpload.updateMany({ where: {
      id: job.id, status: current?.status ?? job.status, updatedAt: current?.updatedAt ?? job.updatedAt,
    }, data: { cleanupAt: new Date() } });
    return Boolean(marked.count);
  } catch {
    incrementRuntimeCounter('image.direct.cleanup_incomplete');
    console.warn('[direct_image_upload] cleanup=incomplete');
    return false;
  }
}

function schedulePrivateCleanup(job: ListingImageUpload, includePublic = true) {
  if (job.cleanupAt) return;
  // Metadata is already durably terminal. A slow storage provider must not hold
  // the customer's cancellation/status response open; cron retries any failure.
  try { after(async () => { await safeDiscard(job, includePublic); }); }
  catch { /* Tests or a stopped request context leave this work to the janitor. */ }
}

export async function getOwnedDirectImageUpload(listingId: string, sellerId: string, uploadId: string) {
  const job = await serializable(async tx => {
    const found = await tx.listingImageUpload.findFirst({ where: { id: uploadId, listingId, sellerId } });
    if (!found) throw new DirectImageUploadError('image_upload_not_found', 404);
    const { allowed } = await ownedTarget(tx, listingId, sellerId);
    if (!allowed) throw new DirectImageUploadError('image_upload_not_found', 404);
    if (isImageUploadActive(found) && !directImageUploadsEnabled()) {
      return tx.listingImageUpload.update({ where: { id: found.id }, data: { status: 'cancelled', errorCode: 'direct_image_uploads_disabled', leaseToken: null, leaseUntil: null } });
    }
    if (['pending', 'processing'].includes(found.status) && found.expiresAt <= new Date()) {
      return tx.listingImageUpload.update({ where: { id: found.id }, data: { status: 'expired', errorCode: 'image_upload_expired', leaseToken: null, leaseUntil: null } });
    }
    if (found.status === 'ready' && !await tx.listingImage.findUnique({ where: { id: found.id }, select: { id: true } })) {
      return tx.listingImageUpload.update({ where: { id: found.id }, data: { status: 'cancelled', errorCode: 'image_deleted' } });
    }
    return found;
  });
  if (['cancelled', 'failed', 'expired'].includes(job.status)) schedulePrivateCleanup(job);
  const { getListing } = await import('./repository');
  const listing = job.status === 'ready' ? await getListing(listingId) : undefined;
  return { upload: imageUploadSummary(job), ...(listing?.sellerId === sellerId ? { listing } : {}) };
}

/** Recover work after leaving an editor or losing a cancellation request offline. */
export async function getOwnedActiveDirectImageUploads(listingId: string, sellerId: string) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') {
    const { getListing } = await import('./repository');
    const listing = await getListing(listingId);
    if (!listing || listing.sellerId !== sellerId || listing.status === 'deleted') {
      throw new DirectImageUploadError('listing_not_found', 404);
    }
    return { uploads: [] };
  }
  const result = await serializable(async tx => {
    const { allowed } = await ownedTarget(tx, listingId, sellerId);
    if (!allowed) throw new DirectImageUploadError('listing_not_found', 404);
    const now = new Date();
    await expireJobs(tx, listingId, now);
    if (!directImageUploadsEnabled()) {
      await tx.listingImageUpload.updateMany({
        where: { listingId, sellerId, status: { in: [...activeImageUploadStatuses] } },
        data: { status: 'cancelled', errorCode: 'direct_image_uploads_disabled', leaseToken: null, leaseUntil: null },
      });
    }
    const uploads = await tx.listingImageUpload.findMany({
      where: { listingId, sellerId, ...activeWhere(now) },
      orderBy: { createdAt: 'asc' }, take: getMaxListingImagesPerListing(),
    });
    const cleanup = await tx.listingImageUpload.findMany({
      where: { listingId, sellerId, status: { in: ['cancelled', 'failed', 'expired'] }, cleanupAt: null },
      orderBy: { updatedAt: 'asc' }, take: getMaxListingImagesPerListing(),
    });
    return { uploads, cleanup };
  });
  for (const job of result.cleanup) schedulePrivateCleanup(job);
  return { uploads: result.uploads.map(imageUploadSummary) };
}

export async function cancelOwnedDirectImageUpload(listingId: string, sellerId: string, uploadId: string) {
  const job = await serializable(async tx => {
    const found = await tx.listingImageUpload.findFirst({ where: { id: uploadId, listingId, sellerId } });
    const seller = await tx.user.findUnique({ where: { id: sellerId }, select: { deletedAt: true } });
    if (!found || !seller || seller.deletedAt) throw new DirectImageUploadError('image_upload_not_found', 404);
    if (found.status === 'ready') throw new DirectImageUploadError('image_upload_already_ready', 409);
    if (!['pending', 'processing'].includes(found.status)) return found;
    return tx.listingImageUpload.update({ where: { id: found.id }, data: { status: 'cancelled', errorCode: null, leaseToken: null, leaseUntil: null } });
  });
  schedulePrivateCleanup(job);
  return { upload: imageUploadSummary(job) };
}

const discardClaim = (job?: ListingImageUpload | null) => ({
  action: 'discard' as const,
  ...(job ? { source: { key: job.sourceKey }, targets: { original: job.originalKey, display: job.displayKey, thumbnail: job.thumbnailKey } } : {}),
});

export async function claimDirectImageUpload(uploadId: string) {
  const result = await serializable(async tx => {
    const job = await tx.listingImageUpload.findUnique({ where: { id: uploadId } });
    if (!job) return discardClaim();
    const now = new Date();
    if (!['pending', 'processing'].includes(job.status)) return discardClaim(job);
    if (job.status === 'processing' && job.leaseUntil && job.leaseUntil > now) {
      throw new DirectImageUploadError('image_upload_processing', 409);
    }
    const { allowed } = await ownedTarget(tx, job.listingId, job.sellerId);
    if (!directImageUploadsEnabled() || !allowed || job.expiresAt <= now || job.attempts >= directImageUploadMaxAttempts) {
      const status = job.expiresAt <= now ? 'expired' : job.attempts >= directImageUploadMaxAttempts ? 'failed' : 'cancelled';
      await tx.listingImageUpload.update({ where: { id: job.id }, data: { status, errorCode: status === 'failed' ? 'image_processing_attempts_exhausted' : null, leaseToken: null, leaseUntil: null } });
      return discardClaim(job);
    }
    const leaseToken = randomUUID();
    const updated = await tx.listingImageUpload.update({ where: { id: job.id }, data: {
      status: 'processing', leaseToken, leaseUntil: new Date(now.getTime() + directImageUploadLeaseMs),
      attempts: { increment: 1 }, ...imageUploadObjectKeys(job.id, leaseToken), errorCode: null,
    } });
    return { action: 'process' as const, leaseToken,
      source: { key: updated.sourceKey, sha256: updated.sha256, sizeBytes: updated.sizeBytes },
      targets: { original: updated.originalKey, display: updated.displayKey, thumbnail: updated.thumbnailKey },
    };
  });
  if (result.action === 'discard') {
    const terminal = await prisma.listingImageUpload.findUnique({ where: { id: uploadId } });
    if (terminal) schedulePrivateCleanup(terminal, terminal.status !== 'ready');
  }
  return result;
}

async function validateProcessedImage(image: { data: Uint8Array; mediaType: string }, variant: 'original' | 'display' | 'thumbnail', mediaType: string) {
  const format = mediaType === 'image/jpeg' ? 'jpeg' : 'webp';
  if (image.mediaType.split(';')[0] !== `image/${format}` || image.data.byteLength === 0 || image.data.byteLength > 12 * 1024 * 1024) {
    throw new DirectImageUploadError('invalid_processed_image', 422);
  }
  const metadata = await sharp(image.data, { animated: true, failOn: 'warning', limitInputPixels: 45_000_000 }).metadata()
    .catch(() => { throw new DirectImageUploadError('invalid_processed_image', 422); });
  const max = variant === 'original' ? 1800 : variant === 'display' ? 900 : 360;
  if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width > max || metadata.height > max ||
    (metadata.pages ?? 1) !== 1 || metadata.exif || metadata.xmp || metadata.iptc) {
    throw new DirectImageUploadError('invalid_processed_image', 422);
  }
}

export const directImageCompleteInput = z.object({
  leaseToken: z.string().uuid(), errorCode: z.string().regex(/^[a-z0-9_]{1,80}$/).optional(), retryable: z.boolean().optional(),
}).strict().refine(value => value.errorCode || value.retryable === undefined);

export async function completeDirectImageUpload(uploadId: string, input: z.infer<typeof directImageCompleteInput>) {
  const job = await prisma.listingImageUpload.findUnique({ where: { id: uploadId } });
  if (!job) return { action: 'discard' as const };
  if (job.status === 'ready') return { action: 'ready' as const };
  if (!isImageUploadActive(job)) {
    if (['pending', 'processing'].includes(job.status)) {
      await prisma.listingImageUpload.updateMany({ where: { id: job.id, status: job.status, expiresAt: { lte: new Date() } },
        data: { status: 'expired', errorCode: 'image_upload_expired', leaseToken: null, leaseUntil: null } });
    }
    schedulePrivateCleanup(job);
    return { action: 'discard' as const };
  }
  if (job.status !== 'processing' || job.leaseToken !== input.leaseToken || !job.leaseUntil || job.leaseUntil <= new Date()) {
    throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
  }
  if (input.errorCode) {
    const retry = input.retryable === true && job.attempts < directImageUploadMaxAttempts && directImageUploadsEnabled();
    const changed = await prisma.listingImageUpload.updateMany({
      where: { id: job.id, status: 'processing', leaseToken: input.leaseToken },
      data: { status: retry ? 'pending' : 'failed', errorCode: input.errorCode, leaseToken: null, leaseUntil: null },
    });
    if (!changed.count) throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
    if (!retry) schedulePrivateCleanup(job);
    return { action: retry ? 'retry' as const : 'discard' as const };
  }
  if (!directImageUploadsEnabled()) {
    const changed = await prisma.listingImageUpload.updateMany({ where: { id: job.id, status: 'processing', leaseToken: input.leaseToken },
      data: { status: 'cancelled', errorCode: 'direct_image_uploads_disabled', leaseToken: null, leaseUntil: null } });
    if (!changed.count) throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
    schedulePrivateCleanup(job);
    return { action: 'discard' as const };
  }
  try {
    const noOriginal = job.originalKey === job.displayKey;
    const variantNames = noOriginal ? ['display', 'thumbnail'] as const : ['original', 'display', 'thumbnail'] as const;
    const variants = await Promise.all(variantNames.map(async variant => {
      const image = await directImageUploadEffects.readImage(job, variant);
      await validateProcessedImage(image, variant, getDirectImageVariantMediaType(job, variant));
      return image;
    }));
    const [original] = variants;
    // The direct/manual upload path performs technical checks only. Hamad
    // retains its independent image understanding and review within chat.
    const quality = analyzeImageQuality({ fileName: job.fileName, mimeType: original.mediaType, sizeBytes: original.data.byteLength });
    const finalized = await serializable(async tx => {
      const current = await tx.listingImageUpload.findUnique({ where: { id: job.id } });
      if (current?.status === 'ready') return 'ready' as const;
      if (!current || !isImageUploadActive(current)) return 'discard' as const;
      if (current.status !== 'processing' || current.leaseToken !== input.leaseToken ||
        !current.leaseUntil || current.leaseUntil <= new Date()) throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
      const { listing, allowed } = await ownedTarget(tx, job.listingId, job.sellerId);
      if (!directImageUploadsEnabled() || !allowed || !listing || listing.images.length >= getMaxListingImagesPerListing()) {
        await tx.listingImageUpload.update({ where: { id: job.id }, data: { status: 'cancelled', errorCode: 'image_upload_target_changed', leaseToken: null, leaseUntil: null } });
        return 'discard' as const;
      }
      // Claim the durable job row before network promotion. Cancellation waits
      // for this transaction; a new lease cannot overwrite an attached image.
      // Resource mutation paths acquire the listing before cancelling its jobs.
      await tx.listing.update({ where: { id: listing.id }, data: { updatedAt: listing.updatedAt } });
      await tx.listingImageUpload.update({ where: { id: job.id }, data: { updatedAt: new Date() } });
      const urls = await directImageUploadEffects.promote(current);
      const approved = listing.images.filter(image => image.status === 'approved');
      const firstBySelection = !approved.some(image => image.createdAt <= job.createdAt);
      if (firstBySelection && approved.length) {
        await tx.listingImage.updateMany({ where: { listingId: job.listingId, isPrimary: true }, data: { isPrimary: false } });
      }
      await tx.listingImage.create({ data: {
        id: job.id, listingId: job.listingId, ...urls, status: 'approved',
        isPrimary: firstBySelection,
        qualityScore: quality.qualityScore, enhancements: quality.enhancements,
        contentReviewStatus: 'not_checked', createdAt: job.createdAt,
      } });
      await tx.listingImageUpload.update({ where: { id: job.id }, data: { status: 'ready', readyAt: new Date(), leaseToken: null, leaseUntil: null, errorCode: null } });
      return 'finalized' as const;
    });
    if (finalized === 'ready') return { action: 'ready' as const };
    if (finalized === 'discard') { schedulePrivateCleanup(job); return { action: 'discard' as const }; }
    scheduleListingEvidenceCopy(job.listingId);
    try {
      const current = await prisma.listing.findUnique({ where: { id: job.listingId }, select: { sellerId: true, status: true } });
      if (current) publishRealtimeEvent({ type: 'ad_updated', payload: { listingId: job.listingId, sellerId: current.sellerId, status: current.status, reason: 'image_added' },
        visibility: { includePublic: current.status === 'published', includeAdmins: true, userIds: [current.sellerId] } });
    } catch { /* Committed writes remain authoritative if event delivery fails. */ }
    incrementRuntimeCounter('image.direct.ready');
    schedulePrivateCleanup(job, false);
    return { action: 'ready' as const };
  } catch (error) {
    // An ambiguous database response must not delete a committed image.
    const attached = await prisma.listingImage.findUnique({ where: { id: job.id }, select: { id: true } });
    if (attached) return { action: 'ready' as const };
    if (error instanceof DirectImageUploadError && error.status === 409) throw error;
    const technical = error instanceof DirectImageUploadError && error.status === 422;
    const changed = await prisma.listingImageUpload.updateMany({ where: { id: job.id, status: 'processing', leaseToken: input.leaseToken },
      data: { status: technical ? 'failed' : 'pending', errorCode: technical ? 'invalid_processed_image' : 'image_processing_unavailable', leaseToken: null, leaseUntil: null } });
    if (!changed.count) throw new DirectImageUploadError('image_upload_lease_mismatch', 409);
    if (technical) schedulePrivateCleanup(job);
    incrementRuntimeCounter('image.direct.incomplete');
    return { action: technical ? 'discard' as const : 'retry' as const };
  }
}

/** Bounded, authenticated maintenance; no image is regenerated during cleanup. */
export async function cleanupExpiredDirectImageUploads(limit = 50) {
  const count = Math.min(100, Math.max(1, Math.floor(limit)));
  await prisma.listingImageUpload.updateMany({ where: {
    status: { in: [...activeImageUploadStatuses] }, expiresAt: { lte: new Date() },
  }, data: { status: 'expired', errorCode: 'image_upload_expired', leaseToken: null, leaseUntil: null } });
  const jobs = await prisma.listingImageUpload.findMany({
    where: { status: { notIn: [...activeImageUploadStatuses] }, cleanupAt: null },
    orderBy: { updatedAt: 'asc' }, take: count,
  });
  const deadline = directImageUploadEffects.now() + 20_000;
  let cleaned = 0;
  let inspected = 0;
  for (const job of jobs) {
    if (directImageUploadEffects.now() >= deadline) break;
    inspected++;
    if (await safeDiscard(job, job.status !== 'ready')) cleaned++;
  }
  // Finished manifests are retained long enough for late events and short-lived
  // transfer URLs, then removed if no final image still refers to their ID.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const old = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT uploads."id" FROM "ListingImageUpload" uploads
    WHERE uploads."status" NOT IN ('pending', 'processing')
      AND uploads."cleanupAt" <= ${cutoff} AND uploads."expiresAt" <= ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "ListingImage" image WHERE image."id" = uploads."id")
    ORDER BY uploads."cleanupAt" ASC LIMIT ${count}
  `);
  if (old.length) {
    const attached = new Set((await prisma.listingImage.findMany({ where: { id: { in: old.map(job => job.id) } }, select: { id: true } })).map(image => image.id));
    const disposable = old.filter(job => !attached.has(job.id)).map(job => job.id);
    if (disposable.length) await prisma.listingImageUpload.deleteMany({ where: {
      id: { in: disposable }, status: { notIn: [...activeImageUploadStatuses] }, cleanupAt: { lte: cutoff }, expiresAt: { lte: cutoff },
    } });
  }
  return { inspected, cleaned, incomplete: inspected - cleaned, remaining: inspected < jobs.length || jobs.length === count };
}
