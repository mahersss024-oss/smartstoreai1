import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';

import { analyzeImageQuality } from './image-quality';
import { createListingImageVariants } from './listing-image-variants';
import { createListingImageDeliveryUrls } from './listing-image-delivery';
import {
  defaultMaxListingImages,
  getMaxListingImagesPerListing,
} from './listing-image-limits';
import { storeListingObject } from './object-storage';
import { addListingImageForSeller, getListing } from './repository';
import type { ListingImage } from './types';

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
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

export async function saveUploadedListingImagesForSeller({
  listingId,
  sellerId,
  images,
}: {
  listingId: string;
  sellerId: string;
  images: UploadedListingImage[];
}) {
  const maxImages = getMaxListingImagesPerListing();
  const existingListing = await getListing(listingId);

  if (!existingListing || existingListing.sellerId !== sellerId) {
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

  for (const uploadedImage of images.slice(0, remainingSlots)) {
    const imageId = randomUUID();
    const imageUrl = await createPersistentListingImageUrl({
      data: uploadedImage.data,
      mediaType: uploadedImage.mediaType,
      imageId,
      fileName: uploadedImage.fileName,
      variant: 'original',
    });

    if (!imageUrl) {
      continue;
    }
    let displayData = uploadedImage.displayData;
    let displayMediaType = uploadedImage.displayMediaType;
    let displayFileName = uploadedImage.displayFileName;
    let thumbnailData = uploadedImage.thumbnailData;
    let thumbnailMediaType = uploadedImage.thumbnailMediaType;
    let thumbnailFileName = uploadedImage.thumbnailFileName;

    if (!displayData || !displayMediaType || !thumbnailData || !thumbnailMediaType) {
      try {
        const generated = await createListingImageVariants(uploadedImage);
        if (generated) {
          displayData = generated.display.data;
          displayMediaType = generated.display.mediaType;
          displayFileName = generated.display.fileName;
          thumbnailData = generated.thumbnail.data;
          thumbnailMediaType = generated.thumbnail.mediaType;
          thumbnailFileName = generated.thumbnail.fileName;
        }
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`[listing_image_variant_generation] failure=${errorName}`);
      }
    }

    const displayUrl =
      displayData && displayMediaType
        ? await createPersistentListingImageUrl({
            data: displayData,
            mediaType: displayMediaType,
            imageId,
            fileName: displayFileName,
            variant: 'display',
          })
        : imageUrl;
    const thumbnailUrl =
      thumbnailData && thumbnailMediaType
        ? await createPersistentListingImageUrl({
            data: thumbnailData,
            mediaType: thumbnailMediaType,
            imageId,
            fileName: thumbnailFileName,
            variant: 'thumbnail',
          })
        : displayUrl;

    const quality = analyzeImageQuality({
      fileName: uploadedImage.fileName,
      mimeType: uploadedImage.mediaType,
      sizeBytes: uploadedImage.data.byteLength,
    });
    const imageUrls = createListingImageDeliveryUrls(imageUrl, {
      displayUrl: displayUrl ?? imageUrl,
      thumbnailUrl: thumbnailUrl ?? displayUrl ?? imageUrl,
    });
    const image: ListingImage = {
      id: imageId,
      listingId,
      ...imageUrls,
      isPrimary: false,
      qualityScore: quality.qualityScore,
      status: quality.listingImageStatus,
      enhancements: quality.enhancements,
    };

    const updatedListing = await addListingImageForSeller(
      listingId,
      sellerId,
      image,
    );

    if (updatedListing) {
      latestListing = updatedListing;
    }
  }

  return latestListing;
}
