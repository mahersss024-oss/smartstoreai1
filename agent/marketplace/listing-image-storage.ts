import { createHash, randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';
import { incrementRuntimeCounter } from '@/lib/observability/runtime-metrics';

import { analyzeImageQuality } from './image-quality';
import {
  createListingImageVariants,
  createSanitizedListingImageOriginal,
} from './listing-image-variants';
import { createListingImageDeliveryUrls } from './listing-image-delivery';
import {
  defaultMaxListingImages,
  getMaxListingImagesPerListing,
} from './listing-image-limits';
import { deleteListingObject, storeListingObject } from './object-storage';
import { addListingImageForSeller, getListing } from './repository';
import type { ListingImage, ImageContentReviewStatus } from './types';

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type UploadedListingImage = {
  data: Uint8Array;
  mediaType: string;
  fileName?: string;
  displayData?: Uint8Array;
  displayMediaType?: string;
  displayFileName?: string;
  thumbnailData?: Uint8Array;
  thumbnailMediaType?: string;
  thumbnailFileName?: string;
};

type ModelImageFilePart = {
  type: 'file';
  mediaType: string;
  data?: unknown;
  filename?: unknown;
};

function isModelImageFilePart(part: unknown): part is ModelImageFilePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as ModelImageFilePart).type === 'file' &&
    typeof (part as ModelImageFilePart).mediaType === 'string' &&
    (part as ModelImageFilePart).mediaType.startsWith('image/')
  );
}

function toBytes(data: unknown) {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return null;
}

export function createPersistentImageDataUrl(
  data: Uint8Array,
  mediaType: string,
) {
  if (!supportedMimeTypes.has(mediaType)) {
    return null;
  }

  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

export function canUseImageDataUrlFallback() {
  return process.env.NODE_ENV !== 'production';
}

export async function createPersistentListingImageUrl({
  data,
  mediaType,
  imageId,
  fileName,
  variant = 'original',
}: {
  data: Uint8Array;
  mediaType: string;
  imageId: string;
  fileName?: string;
  variant?: 'original' | 'display' | 'thumbnail';
}) {
  if (!supportedMimeTypes.has(mediaType)) {
    return null;
  }

  const storedObject = await storeListingObject({
    data,
    mediaType,
    imageId,
    fileName,
    variant,
  });

  if (storedObject?.url) {
    return storedObject.url;
  }

  if (!canUseImageDataUrlFallback()) {
    throw new Error('Listing image object storage is required in production.');
  }

  return createPersistentImageDataUrl(data, mediaType);
}

export function extractLatestUploadedListingImages(
  messages: ModelMessage[],
  maxImages = defaultMaxListingImages,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role !== 'user') {
      continue;
    }
    if (!Array.isArray(message.content)) return [];

    const images: UploadedListingImage[] = [];
    const parts = message.content as unknown[];

    for (const part of parts) {
      if (!isModelImageFilePart(part)) {
        continue;
      }

      const data = toBytes(part.data);

      if (!data || !supportedMimeTypes.has(part.mediaType)) {
        continue;
      }

      images.push({
        data,
        mediaType: part.mediaType,
        fileName: typeof part.filename === 'string' ? part.filename : undefined,
      });
    }

    return images.slice(0, maxImages);
  }

  return [];
}

export async function storeListingImageDelivery({
  imageId,
  variants,
  cleanupOnFailure = true,
}: {
  imageId: string;
  original?: UploadedListingImage;
  variants: Awaited<ReturnType<typeof createListingImageVariants>>;
  /** Deterministic chat IDs may be shared by concurrent draft retries. */
  cleanupOnFailure?: boolean;
}) {
  const results = await Promise.allSettled([
    createPersistentListingImageUrl({ ...variants.display, imageId, variant: 'display' }),
    createPersistentListingImageUrl({ ...variants.thumbnail, imageId, variant: 'thumbnail' }),
  ]);
  if (results.some(result => result.status === 'rejected' || !result.value)) {
    incrementRuntimeCounter('image.delivery.incomplete');
    const storedUrls = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    if (cleanupOnFailure && storedUrls.length) {
      try {
        await deleteListingObject({ imageId, urls: storedUrls });
      } catch {
        incrementRuntimeCounter('image.delivery.cleanup_incomplete');
        console.warn('[listing_image_variant_storage] cleanup=incomplete');
      }
    }
    // Shared deterministic chat objects remain available for a safe later retry.
    throw new Error('Listing image delivery variants could not be stored completely.');
  }
  const [displayUrl, thumbnailUrl] = results.map(result =>
    result.status === 'fulfilled' ? result.value! : '',
  );
  // The database still exposes originalUrl for backwards compatibility. It
  // aliases the largest retained WebP derivative; uploaded/master bytes are
  // never written to public object storage.
  return createListingImageDeliveryUrls(displayUrl, { displayUrl, thumbnailUrl });
}

export async function discardUnattachedListingImage(image: Pick<ListingImage, 'id' | 'listingId' | 'originalUrl' | 'displayUrl' | 'thumbnailUrl'>) {
  try {
    // A failed database response does not prove that its transaction rolled back.
    const listing = await getListing(image.listingId);
    if (listing?.images.some(saved => saved.id === image.id)) return;
    await deleteListingObject({ imageId: image.id, urls: [image.originalUrl, image.displayUrl, image.thumbnailUrl] });
  } catch (error) {
    console.warn(`[listing_image_cleanup] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
  }
}

export async function saveUploadedListingImagesForSeller({
  listingId,
  sellerId,
  images,
  contentReviewStatuses,
  draftOnly = false,
}: {
  listingId: string;
  sellerId: string;
  images: UploadedListingImage[];
  contentReviewStatuses?: ImageContentReviewStatus[];
  draftOnly?: boolean;
}) {
  const maxImages = getMaxListingImagesPerListing();
  const existingListing = await getListing(listingId);

  if (!existingListing || existingListing.sellerId !== sellerId || (draftOnly && existingListing.status !== 'draft')) {
    return null;
  }

  const remainingSlots = Math.max(
    maxImages - existingListing.images.length,
    0,
  );

  if (remainingSlots === 0) {
    return existingListing;
  }

  let latestListing = existingListing;
  const initialImageCount = existingListing.images.length;
  let storageFailure: unknown;

  for (const [index, uploadedImage] of images.entries()) {
    const imageId = draftOnly ? `chat-image-${createHash('sha256').update(listingId).update(uploadedImage.data).digest('hex')}` : randomUUID();
    if (latestListing.images.some(image => image.id === imageId)) continue;
    if (latestListing.images.length >= maxImages) break;
    let sanitizedOriginal: Awaited<
      ReturnType<typeof createSanitizedListingImageOriginal>
    >;
    let generatedVariants: Awaited<ReturnType<typeof createListingImageVariants>>;

    try {
      sanitizedOriginal = await createSanitizedListingImageOriginal(
        uploadedImage,
      );
      // Derive both delivery sizes from the sanitized WebP held in memory.
      // Only display and thumbnail are persisted; the master is discarded.
      generatedVariants = await createListingImageVariants(sanitizedOriginal);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.warn(`[listing_image_security] failure=${errorName}`);
      continue;
    }

    let imageUrls: Awaited<ReturnType<typeof storeListingImageDelivery>>;
    try {
      imageUrls = await storeListingImageDelivery({ imageId, original: sanitizedOriginal, variants: generatedVariants, cleanupOnFailure: !draftOnly });
    } catch (error) {
      console.warn(`[listing_image_storage] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
      storageFailure = error;
      continue;
    }
    if (!imageUrls) continue;

    const quality = analyzeImageQuality({
      fileName: uploadedImage.fileName,
      mimeType: sanitizedOriginal.mediaType,
      sizeBytes: sanitizedOriginal.data.byteLength,
    });
    const image: ListingImage = {
      contentReviewStatus: contentReviewStatuses?.[index],
      id: imageId,
      listingId,
      ...imageUrls,
      isPrimary: false,
      qualityScore: quality.qualityScore,
      status: 'approved',
      enhancements: quality.enhancements,
    };

    const updatedListing = await addListingImageForSeller(
      listingId,
      sellerId,
      image,
      { draftOnly },
    ).catch(async (error: unknown) => {
      await discardUnattachedListingImage(image);
      throw error;
    });

    if (!updatedListing?.images.some(saved => saved.id === image.id)) {
      await discardUnattachedListingImage(image);
      if (!updatedListing) return null;
      break;
    }

    if (updatedListing) {
      latestListing = updatedListing;
    }
  }

  if (storageFailure && latestListing.images.length === initialImageCount) {
    throw storageFailure;
  }
  return latestListing;
}
