import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { schedulePendingImageObjectCleanup } from './image-object-cleanup';
import { planListingObjectStorage } from './object-storage';

type DeliveryUrls = { originalUrl: string; displayUrl: string; thumbnailUrl: string };
type VariantInput = { mediaType: string; fileName?: string };
const pendingDeliveryDelayMs = 10 * 60_000;

function uniqueUrls(image: DeliveryUrls) {
  return [...new Set([image.originalUrl, image.displayUrl, image.thumbnailUrl].filter(Boolean))].sort();
}

function receiptKey(urls: string[]) {
  return `legacy-upload:${createHash('sha256').update(JSON.stringify(urls)).digest('hex')}`;
}

function preparedReceiptKey(image: DeliveryUrls) {
  const urls = uniqueUrls(image);
  const hasPreparedUrl = urls.some(url => {
    try { return /--upload-[a-f0-9-]{36}-(?:display|thumbnail)\.webp$/.test(new URL(url).pathname); }
    catch { return false; }
  });
  return hasPreparedUrl ? receiptKey(urls) : null;
}

/** Record all intended public bytes before the first PUT. Each attempt owns its
 * bytes, even when concurrent chat requests share the logical ListingImage.id. */
export async function prepareListingImageDelivery(imageId: string, variants: { display: VariantInput; thumbnail: VariantInput }) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return null;
  const objectImageId = `${imageId}--upload-${randomUUID()}`;
  const display = planListingObjectStorage({ ...variants.display, imageId: objectImageId, variant: 'display' });
  const thumbnail = planListingObjectStorage({ ...variants.thumbnail, imageId: objectImageId, variant: 'thumbnail' });
  if (!display || !thumbnail) return null;
  const image = { originalUrl: display.url, displayUrl: display.url, thumbnailUrl: thumbnail.url };
  const urls = uniqueUrls(image);
  const cleanupImageId = receiptKey(urls);
  await prisma.imageObjectCleanup.create({ data: {
    imageId: cleanupImageId, urls, nextAttemptAt: new Date(Date.now() + pendingDeliveryDelayMs),
  } });
  return { objectImageId, display, thumbnail, cleanupImageId };
}

/** Inside the ListingImage create transaction, after checking logical-ID replay.
 * Deletion of this unclaimed receipt and the new reference commit together. A
 * concurrent cleaner either loses its claim or forces this attachment to retry
 * with fresh object keys; it can never delete bytes newly attached afterward. */
export async function sealPreparedListingImageDelivery(
  database: Pick<Prisma.TransactionClient, 'imageObjectCleanup'>,
  image: DeliveryUrls,
) {
  const imageId = preparedReceiptKey(image);
  if (!imageId) return;
  const sealed = await database.imageObjectCleanup.deleteMany({ where: {
    imageId, attempts: 0, cleanupAt: null, leaseToken: null,
  } });
  if (sealed.count !== 1) throw new Error('prepared_image_delivery_expired');
}

/** Retryable cleanup owns exact URLs, not a shared logical image ID. Missing or
 * removed receipts may mean the attach transaction committed successfully. */
export async function discardPreparedListingImageDelivery(image: DeliveryUrls) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return false;
  const imageId = preparedReceiptKey(image);
  if (!imageId) return false;
  const urls = uniqueUrls(image);
  // A PUT can finish around an older cleanup. Reopen completed receipts and
  // invalidate old completion tokens just like late private-evidence uploads.
  // A non-null token also prevents a cancelled attempt from being attached.
  const discarded = { urls, cleanupAt: null, nextAttemptAt: new Date(), leaseToken: randomUUID(), leaseUntil: null };
  await prisma.imageObjectCleanup.upsert({ where: { imageId },
    create: { imageId, ...discarded }, update: discarded });
  schedulePendingImageObjectCleanup();
  return true;
}
