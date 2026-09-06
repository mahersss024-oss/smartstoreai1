import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import type { ModelMessage } from 'ai';

import { analyzeImageQuality } from './image-quality';
import { addListingImageForSeller } from './repository';
import type { ListingImage } from './types';

const supportedMimeTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

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

function getSafeExtension(mediaType: string, fileName?: string) {
  return (
    supportedMimeTypes.get(mediaType) ??
    (fileName ? extname(fileName).toLowerCase() : '') ??
    '.jpg'
  );
}

function getPublicUploadUrl(
  listingId: string,
  imageId: string,
  extension: string,
) {
  return `/uploads/listings/${encodeURIComponent(listingId)}/${imageId}${extension}`;
}

export function extractLatestUploadedListingImages(
  messages: ModelMessage[],
  maxImages = 8,
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
  let latestListing = null;
  const safeListingPathSegment = listingId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const uploadDirectory = join(
    process.cwd(),
    'public',
    'uploads',
    'listings',
    safeListingPathSegment,
  );

  await mkdir(uploadDirectory, { recursive: true });

  for (const uploadedImage of images.slice(0, 8)) {
    const imageId = randomUUID();
    const extension = getSafeExtension(
      uploadedImage.mediaType,
      uploadedImage.fileName,
    );
    const uploadPath = join(uploadDirectory, `${imageId}${extension}`);
    const uploadUrl = getPublicUploadUrl(
      safeListingPathSegment,
      imageId,
      extension,
    );
    const quality = analyzeImageQuality({
      fileName: uploadedImage.fileName,
      mimeType: uploadedImage.mediaType,
      sizeBytes: uploadedImage.data.byteLength,
    });
    const image: ListingImage = {
      id: imageId,
      listingId,
      originalUrl: uploadUrl,
      displayUrl: uploadUrl,
      thumbnailUrl: uploadUrl,
      isPrimary: false,
      qualityScore: quality.qualityScore,
      status: quality.listingImageStatus,
      enhancements: quality.enhancements,
    };

    await writeFile(uploadPath, Buffer.from(uploadedImage.data));
    latestListing = await addListingImageForSeller(listingId, sellerId, image);
  }

  return latestListing;
}
