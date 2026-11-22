import { createHash } from 'node:crypto';
import type { UploadedListingImage } from '@/agent/marketplace/listing-image-storage';

export function draftImageSource(sourceId: string | undefined, images: readonly UploadedListingImage[]) {
  if (!sourceId || !images.length) return undefined;
  const digest = createHash('sha256');
  for (const image of images) {
    digest.update(`${image.mediaType}:${image.data.byteLength}:`).update(image.data);
  }
  return { sourceId, digest: digest.digest('hex') };
}
