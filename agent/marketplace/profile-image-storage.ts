import { storeListingObject } from './object-storage';

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function createPersistentProfileImageDataUrl(
  data: Uint8Array,
  mediaType: string,
) {
  if (!supportedMimeTypes.has(mediaType)) {
    return null;
  }

  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

export function canUseProfileImageDataUrlFallback() {
  return process.env.NODE_ENV !== 'production';
}

export async function createPersistentProfileImageUrl({
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
    objectPrefix: 'profiles',
    variant: 'original',
  });

  if (storedObject?.url) {
    return storedObject.url;
  }

  if (!canUseProfileImageDataUrlFallback()) {
    throw new Error('Profile image object storage is required in production.');
  }

  return createPersistentProfileImageDataUrl(data, mediaType);
}
