import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';

import { analyzeImageQuality } from './image-quality';
import {
  defaultMaxListingImages,
  getMaxListingImagesPerListing,
} from './listing-image-limits';
import { storeListingObject } from './object-storage';
import { addListingImageForSeller, getListing } from './repository';
import type { ListingImage } from './types';

const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type UploadedListingImage = {
  data: Uint8Array;
  mediaType: string;
  fileName?: string;
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

export async function createPersistentListingImageUrl({
  data,
  mediaType,
  imageId,
  fileName,
}: {
  data: Uint8Array;
  mediaType: string;
  imageId: string;
  fileName?: string;
}) {
  if (!supportedMimeTypes.has(mediaType)) {
    return null;
  }

  const storedObject = await storeListingObject({
    data,
    mediaType,
    imageId,
    fileName,
  });

  return storedObject?.url ?? createPersistentImageDataUrl(data, mediaType);
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
    });

    if (!imageUrl) {
      continue;
    }

    const quality = analyzeImageQuality({
      fileName: uploadedImage.fileName,
      mimeType: uploadedImage.mediaType,
      sizeBytes: uploadedImage.data.byteLength,
    });
    const image: ListingImage = {
      id: imageId,
      listingId,
      originalUrl: imageUrl,
      displayUrl: imageUrl,
      thumbnailUrl: imageUrl,
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
