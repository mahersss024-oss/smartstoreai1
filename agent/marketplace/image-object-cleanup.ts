import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { after } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { deleteEvidenceObject, deleteListingObject, isOwnedProfileImageUrl } from './object-storage';
import { directImagePromotionUploadId } from './direct-image-promotion';

type CleanupDatabase = Pick<Prisma.TransactionClient, 'imageObjectCleanup'>;
type CleanupInput = { imageId: string; urls: string[]; ownerId?: string };
const leaseMs = 60_000;

/** Call inside the same transaction that removes its authoritative reference. */
export async function enqueueImageObjectCleanup(database: CleanupDatabase, input: CleanupInput) {
  const urls = [...new Set(input.urls.filter(Boolean))];
  if (!urls.length) return;
  return database.imageObjectCleanup.upsert({ where: { imageId: input.imageId },
    create: { imageId: input.imageId, ownerId: input.ownerId, urls }, update: {} });
}

/** Private evidence cleanup is issued only from database-owned asset manifests. */
export async function enqueueEvidenceObjectCleanup(database: CleanupDatabase, asset: {
  id: string; caseId: string; sourceHash: string; objectKey: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(asset.sourceHash) || !asset.caseId || asset.caseId.includes('/') || asset.caseId === '..' ||
    asset.objectKey !== `cases/${asset.caseId}/${asset.sourceHash}`) throw new Error('invalid_evidence_object_key');
  const imageId = `evidence:${asset.id}`;
  const urls = [asset.objectKey];
  return database.imageObjectCleanup.upsert({ where: { imageId }, create: { imageId, urls },
    // A copy can finish after a previous deletion began. Invalidate that lease
    // so its stale completion cannot close the renewed cleanup receipt.
    update: { urls, cleanupAt: null, nextAttemptAt: new Date(), leaseToken: null, leaseUntil: null } });
}

export function profileImageCleanupInput(userId: string, picture?: string | null): CleanupInput | undefined {
  if (!picture || !isOwnedProfileImageUrl(userId, picture)) return undefined;
  return { imageId: `profile:${userId}:${createHash('sha256').update(picture).digest('hex')}`,
    ownerId: userId, urls: [picture] };
}

export async function processImageObjectCleanup(imageId: string, deadline = Date.now() + 20_000) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database' || deadline <= Date.now()) return false;
  const job = await prisma.imageObjectCleanup.findUnique({ where: { imageId } });
  if (!job || job.cleanupAt) return true;
  const now = new Date();
  const leaseToken = randomUUID();
  const claimed = await prisma.imageObjectCleanup.updateMany({ where: {
    id: job.id, cleanupAt: null, nextAttemptAt: { lte: now },
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
  }, data: { leaseToken, leaseUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } } });
  if (!claimed.count) return false;
  const directUploadId = directImagePromotionUploadId(job.imageId);
  if (directUploadId) {
    const upload = await prisma.listingImageUpload.findUnique({ where: { id: directUploadId } });
    if (upload && ['pending', 'processing'].includes(upload.status) && upload.expiresAt > new Date()) {
      // No DELETE has started. Release only our own claim so an active/new lease
      // may reserve the same fixed URLs; a writer never steals a cleaner token.
      await prisma.imageObjectCleanup.updateMany({ where: { id: job.id, leaseToken, cleanupAt: null },
        data: { leaseToken: null, leaseUntil: null, attempts: 0, nextAttemptAt: new Date(Date.now() + 60_000) } });
      return false;
    }
  }
  let completed = false;
  try {
    if (job.imageId.startsWith('evidence:')) {
      // A private storage key is never interpreted as a public listing URL.
      if (job.ownerId || job.urls.some(key => !/^cases\/[^/]+\/[a-f0-9]{64}$/.test(key) || key.split('/').includes('..'))) {
        throw new Error('invalid_evidence_object_key');
      }
      const attached = await prisma.evidenceAsset.count({ where: { objectKey: { in: job.urls } } });
      if (!attached) {
        for (const key of job.urls) {
          if (Date.now() >= deadline) throw new Error('evidence_cleanup_deadline');
          await deleteEvidenceObject(key, deadline);
        }
        completed = true;
      }
    } else {
      // A still-attached object can have been selected again while cleanup waited.
      // A profile URL held by another user is not an ownership claim on its bytes.
      if (job.ownerId && !job.urls.every(url => isOwnedProfileImageUrl(job.ownerId!, url))) {
        completed = true; // Drop the reference; never delete unproven legacy bytes.
      } else {
        const attached = await prisma.user.count({ where: { picture: { in: job.urls } } }) +
          (job.ownerId ? 0 : await prisma.listingImage.count({ where: { OR: [
            { originalUrl: { in: job.urls } }, { displayUrl: { in: job.urls } }, { thumbnailUrl: { in: job.urls } },
          ] } }));
        if (!attached) completed = await deleteListingObject({ imageId: job.imageId, urls: job.urls,
          requireCachePurge: true, deadline });
        else if (job.imageId.startsWith('legacy-upload:') || directUploadId) {
          // An unknown attach commit may have reopened its attempt receipt. The
          // authoritative image now owns these bytes; its eventual deletion
          // creates the ordinary cleanup manifest in the same database commit.
          completed = true;
        }
      }
    }
  } catch {
    console.warn('[image_object_cleanup] outcome=incomplete');
  }
  const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(job.attempts, 6));
  await prisma.imageObjectCleanup.updateMany({ where: { id: job.id, leaseToken, cleanupAt: null },
    data: { leaseToken: null, leaseUntil: null,
      ...(completed ? { cleanupAt: new Date(), urls: [] } : { nextAttemptAt: new Date(Date.now() + delay) }) } });
  return completed;
}

export async function cleanupPendingImageObjects(limit = 5) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return { inspected: 0, cleaned: 0 };
  const jobs = await prisma.imageObjectCleanup.findMany({ where: { cleanupAt: null,
    nextAttemptAt: { lte: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
  orderBy: { nextAttemptAt: 'asc' }, take: Math.min(20, Math.max(1, Math.floor(limit))) });
  const deadline = Date.now() + 20_000;
  let inspected = 0;
  let cleaned = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    inspected++;
    if (await processImageObjectCleanup(job.imageId, deadline)) cleaned++;
  }
  const completed = await prisma.imageObjectCleanup.findMany({
    where: { cleanupAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
    select: { id: true }, take: 50,
  });
  if (completed.length) await prisma.imageObjectCleanup.deleteMany({ where: {
    id: { in: completed.map(job => job.id) }, cleanupAt: { not: null },
  } });
  return { inspected, cleaned };
}

let nextBackgroundCleanup = 0;
/** Bootstrap activity retries persisted failures even without the optional Worker. */
export function schedulePendingImageObjectCleanup() {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database' || Date.now() < nextBackgroundCleanup) return;
  nextBackgroundCleanup = Date.now() + 60_000;
  try { after(async () => { await cleanupPendingImageObjects().catch(() => {
    console.warn('[image_object_cleanup] background=incomplete');
  }); }); } catch { /* No request context: durable jobs remain for the next request/cron. */ }
}
