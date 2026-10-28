import { createHash, timingSafeEqual } from 'node:crypto';

export const directImageUploadProtocol = 'r2-direct-v1';
export const directImageUploadLifetimeMs = 24 * 60 * 60_000;
export const directImageUploadLeaseMs = 5 * 60_000;
export const directImageUploadMaxAttempts = 5;
export const activeImageUploadStatuses = ['pending', 'processing'] as const;
export type DirectImageUploadStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'cancelled' | 'expired';

export function directImageUploadsEnabled() {
  return process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS === 'true' &&
    process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

/** Retry only the transaction, never its publication/model side effects. */
export async function retryDirectImageTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const retries = directImageUploadsEnabled() ? 4 : 0;
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (code !== 'P2034' || attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1) + Math.floor(Math.random() * 40)));
    }
  }
}

export function isImageUploadActive(job: { status: string; expiresAt: Date }, now = new Date()) {
  return activeImageUploadStatuses.some(status => status === job.status) && job.expiresAt > now;
}

export function imageUploadObjectKeys(id: string, leaseToken = 'unclaimed', outputFormat: 'jpeg' | 'webp' = 'jpeg') {
  return {
    sourceKey: `intake/v1/${id}.jpg`,
    originalKey: `staged/v1/${id}/${leaseToken}/original.${outputFormat === 'webp' ? 'webp' : 'jpg'}`,
    displayKey: `staged/v1/${id}/${leaseToken}/display.webp`,
    thumbnailKey: `staged/v1/${id}/${leaseToken}/thumbnail.webp`,
  };
}

export function imageUploadFingerprint(input: { fileName: string; mediaType: string; sizeBytes: number; sha256: string }) {
  return createHash('sha256').update(JSON.stringify([input.fileName, input.mediaType, input.sizeBytes, input.sha256])).digest('hex');
}

export function verifyImageWorkerSecret(authorization: string | null, expected: string | undefined) {
  if (!expected || expected.length < 32 || !authorization?.startsWith('Bearer ')) return false;
  const given = Buffer.from(authorization.slice(7));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function imageUploadTargetAllowed(listing: { sellerId: string; status: string; compliance: unknown } | null, sellerId: string, seller: { deletedAt: Date | null } | null) {
  if (!listing || listing.sellerId !== sellerId || !seller || seller.deletedAt) return false;
  // Owners can correct images of rejected listings through the legacy editor.
  // Attaching a technically valid image never changes moderation or publishes it.
  return listing.status !== 'deleted';
}

export class DirectImageUploadError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'DirectImageUploadError'; }
}
