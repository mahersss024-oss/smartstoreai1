import { createHash, randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';

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

    if (message.role !== 'user' || !Array.isArray(message.content)) {
      continue;
    }

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

    if (images.length) {
      return images.slice(0, maxImages);
    }
  }

  return [];
}

export async function storeListingImageDelivery({
  imageId,
  original,
  variants,
}: {
  imageId: string;
  original: UploadedListingImage;
  variants: Awaited<ReturnType<typeof createListingImageVariants>>;
}) {
  const originalUrl = await createPersistentListingImageUrl({ ...original, imageId, variant: 'original' });
  if (!originalUrl) return null;

  const saveVariant = async (variant: 'display' | 'thumbnail', fallback: string) => {
    try {
      return (await createPersistentListingImageUrl({ ...variants[variant], imageId, variant })) ?? fallback;
    } catch (error) {
      console.warn(`[listing_image_variant_storage] variant=${variant} failure=${error instanceof Error ? error.name : 'UnknownError'}`);
      return fallback;
    }
  };
  // Independent writes let a thumbnail succeed even when the display write fails.
  const displayUrl = await saveVariant('display', originalUrl);
  const thumbnailUrl = await saveVariant('thumbnail', displayUrl);
  return createListingImageDeliveryUrls(originalUrl, { displayUrl, thumbnailUrl });
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
      generatedVariants = await createListingImageVariants(uploadedImage);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.warn(`[listing_image_security] failure=${errorName}`);
      continue;
    }

    let imageUrls: Awaited<ReturnType<typeof storeListingImageDelivery>>;
    try {
      imageUrls = await storeListingImageDelivery({ imageId, original: sanitizedOriginal, variants: generatedVariants });
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
