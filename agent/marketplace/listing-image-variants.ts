import sharp from 'sharp';
import type { Metadata } from 'sharp';

export const listingOriginalMaxDimension = 1800;
export const listingDisplayMaxDimension = 900;
export const listingThumbnailMaxDimension = 360;
const listingImageMaxInputPixels = 45_000_000;

export class ListingImageSecurityError extends Error {
  constructor(
    public readonly code:
      | 'unsupported_image_type'
      | 'image_type_mismatch'
      | 'image_decode_failed'
      | 'image_dimensions_invalid'
      | 'animated_image_not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'ListingImageSecurityError';
  }
}

export type GeneratedListingImageVariant = {
  data: Uint8Array;
  mediaType: 'image/jpeg' | 'image/webp';
  fileName: string;
  width: number;
  height: number;
};

function getBaseName(fileName?: string) {
  return (fileName?.replace(/\.[^.]+$/, '') || 'listing-image')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);
}

export function detectListingImageMimeType(data: Uint8Array) {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'image/jpeg' as const;
  }

  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png' as const;
  }

  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image/webp' as const;
  }

  return null;
}

function assertDetectedMimeType(input: {
  data: Uint8Array;
  mediaType: string;
}) {
  const detectedMediaType = detectListingImageMimeType(input.data);

  if (!detectedMediaType) {
    throw new ListingImageSecurityError(
      'unsupported_image_type',
      'Image magic bytes are not a supported image type.',
    );
  }

  if (detectedMediaType !== input.mediaType) {
    throw new ListingImageSecurityError(
      'image_type_mismatch',
      'Image content type does not match the uploaded bytes.',
    );
  }

  return detectedMediaType;
}

async function readSecureMetadata(input: {
  data: Uint8Array;
  mediaType: string;
}) {
  const detectedMediaType = assertDetectedMimeType(input);
  let metadata: Metadata;

  try {
    metadata = await sharp(input.data, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: listingImageMaxInputPixels,
    }).metadata();
  } catch {
    throw new ListingImageSecurityError(
      'image_decode_failed',
      'Image could not be decoded safely.',
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width <= 0 || height <= 0) {
    throw new ListingImageSecurityError(
      'image_dimensions_invalid',
      'Image dimensions are invalid.',
    );
  }

  if ((metadata.pages ?? 1) > 1) {
    throw new ListingImageSecurityError(
      'animated_image_not_allowed',
      'Animated listing images are not accepted.',
    );
  }

  return { detectedMediaType, width, height };
}

export async function createSanitizedListingImageOriginal(input: {
  data: Uint8Array;
  mediaType: string;
  fileName?: string;
}): Promise<GeneratedListingImageVariant & { detectedMediaType: string }> {
  const metadata = await readSecureMetadata(input);
  const baseName = getBaseName(input.fileName);
  const { data, info } = await sharp(input.data, {
    failOn: 'warning',
    limitInputPixels: listingImageMaxInputPixels,
  })
    .rotate()
    .resize({
      width: listingOriginalMaxDimension,
      height: listingOriginalMaxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8Array(data),
    mediaType: 'image/jpeg',
    fileName: `${baseName}-original.jpg`,
    width: info.width,
    height: info.height,
    detectedMediaType: metadata.detectedMediaType,
  };
}

export async function createListingImageVariants(input: {
  data: Uint8Array;
  mediaType: string;
  fileName?: string;
}) {
  await readSecureMetadata(input);
  const baseName = getBaseName(input.fileName);

  async function createVariant(
    maxDimension: number,
    quality: number,
    suffix: 'display' | 'thumbnail',
  ): Promise<GeneratedListingImageVariant> {
    const { data, info } = await sharp(input.data, {
      failOn: 'warning',
      limitInputPixels: listingImageMaxInputPixels,
    })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8Array(data),
      mediaType: 'image/webp',
      fileName: `${baseName}-${suffix}.webp`,
      width: info.width,
      height: info.height,
    };
  }

  const [display, thumbnail] = await Promise.all([
    createVariant(listingDisplayMaxDimension, 78, 'display'),
    createVariant(listingThumbnailMaxDimension, 68, 'thumbnail'),
  ]);

  return { display, thumbnail };
}
