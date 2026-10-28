import { createListingImageVariants } from '@/agent/marketplace/listing-image-variants';
import { storeListingObject } from '@/agent/marketplace/object-storage';
import { prisma } from '@/lib/db/prisma';

const apply = process.argv.includes('--apply');
const batchSizeArgument = process.argv.find((value) => value.startsWith('--batch-size='));
const requestedBatchSize = Number(batchSizeArgument?.split('=')[1] ?? 25);
const batchSize = Number.isInteger(requestedBatchSize)
  ? Math.min(Math.max(requestedBatchSize, 1), 100)
  : 25;

function needsVariants(image: { originalUrl: string; displayUrl: string; thumbnailUrl: string }) {
  return (
    !image.displayUrl ||
    !image.thumbnailUrl ||
    image.displayUrl === image.originalUrl ||
    image.thumbnailUrl === image.originalUrl ||
    image.thumbnailUrl === image.displayUrl
  );
}

async function main() {
  const totals = { scanned: 0, skipped: 0, converted: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 };
  let cursor: string | undefined;

  for (;;) {
    const records = await prisma.listingImage.findMany({
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, originalUrl: true, displayUrl: true, thumbnailUrl: true },
    });
    if (!records.length) break;

    for (const image of records) {
      totals.scanned += 1;
      if (!needsVariants(image)) {
        totals.skipped += 1;
        continue;
      }

      try {
        const response = await fetch(image.originalUrl, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`source_http_${response.status}`);
        const sourceData = new Uint8Array(await response.arrayBuffer());
        const contentType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
        const variants = await createListingImageVariants({
          data: sourceData,
          mediaType: contentType,
          fileName: new URL(image.originalUrl).pathname.split('/').pop(),
        });
        totals.bytesBefore += sourceData.byteLength;

        if (!variants) {
          totals.skipped += 1;
          console.log(JSON.stringify({ id: image.id, status: 'skipped', reason: 'animated_image' }));
          continue;
        }

        const bytesAfter = variants.display.data.byteLength + variants.thumbnail.data.byteLength;
        totals.bytesAfter += bytesAfter;

        if (apply) {
          const variantImageId = `${image.id}-backfill-v1`;
          const [display, thumbnail] = await Promise.all([
            storeListingObject({ ...variants.display, imageId: variantImageId, variant: 'display' }),
            storeListingObject({ ...variants.thumbnail, imageId: variantImageId, variant: 'thumbnail' }),
          ]);
          if (!display?.url || !thumbnail?.url) throw new Error('object_storage_unavailable');
          // Respect a newer repair/finalization rather than overwriting URLs
          // that changed while this maintenance process generated the variants.
          const updated = await prisma.listingImage.updateMany({
            where: { id: image.id, originalUrl: image.originalUrl,
              displayUrl: image.displayUrl, thumbnailUrl: image.thumbnailUrl },
            data: { displayUrl: display.url, thumbnailUrl: thumbnail.url },
          });
          if (!updated.count) {
            totals.skipped += 1;
            console.log(JSON.stringify({ id: image.id, status: 'skipped', reason: 'image_changed_during_processing' }));
            continue;
          }
        }

        totals.converted += 1;
        console.log(JSON.stringify({
          id: image.id,
          status: apply ? 'converted' : 'dry_run',
          originalUrl: image.originalUrl,
          bytesBefore: sourceData.byteLength,
          bytesAfter,
          savingsPercent: Math.round((1 - bytesAfter / sourceData.byteLength) * 1000) / 10,
          display: { bytes: variants.display.data.byteLength, width: variants.display.width, height: variants.display.height },
          thumbnail: { bytes: variants.thumbnail.data.byteLength, width: variants.thumbnail.width, height: variants.thumbnail.height },
        }));
      } catch (error) {
        totals.failed += 1;
        console.error(JSON.stringify({
          id: image.id,
          status: 'failed',
          reason: error instanceof Error ? error.message : 'unknown_error',
        }));
      }
    }

    cursor = records.at(-1)?.id;
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...totals }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
