import { prisma } from '@/lib/db/prisma';
import { incrementRuntimeCounter } from '@/lib/observability/runtime-metrics';
import {
  createPresignedRequest,
  deleteListingObject,
  getMissingObjectStorageConfig,
  getS3ObjectStorageConfig,
  type S3ObjectStorageConfig,
} from './object-storage';
import { ImageStorageResponseError, retryImageStorage } from './image-storage-retry';

export type DirectImageVariant = 'original' | 'display' | 'thumbnail';
export type DirectImageObjectJob = {
  id: string;
  listingId: string;
  sellerId: string;
  sourceKey: string;
  originalKey: string | null;
  displayKey: string | null;
  thumbnailKey: string | null;
  sha256: string;
  sizeBytes: number;
  expiresAt: Date;
  createdAt: Date;
};

const maxImageBytes = 12 * 1024 * 1024;
const finalCacheControl = 'public, max-age=31536000, immutable';
export function getDirectImageVariantMediaType(job: DirectImageObjectJob, variant: DirectImageVariant): 'image/jpeg' | 'image/webp' {
  // The output choice is durable in the server-generated original target.
  // Legacy jobs keep their JPEG destination across retries and deployments.
  return variant === 'original' && !job.originalKey?.endsWith('/original.webp') ? 'image/jpeg' : 'image/webp';
}

/** Server-only configuration. Never serialize storage credentials in bootstrap. */
export function getDirectImageUploadConfiguration(options: { ignoreEnabled?: boolean } = {}) {
  if (!options.ignoreEnabled && process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS !== 'true') return null;
  const storage = getS3ObjectStorageConfig();
  const intakeBucket = process.env.SMARTSTORE_IMAGE_INTAKE_BUCKET?.trim();
  const workerSecret = process.env.SMARTSTORE_IMAGE_WORKER_SECRET?.trim();
  const evidenceBucket = process.env.SMARTSTORE_EVIDENCE_STORAGE_BUCKET?.trim();
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database' ||
    !['object', 's3'].includes(process.env.SMARTSTORE_IMAGE_STORAGE?.trim().toLowerCase() ?? '') ||
    getMissingObjectStorageConfig().length || !intakeBucket || !workerSecret || workerSecret.length < 32 ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(intakeBucket) ||
    intakeBucket === storage.bucket || intakeBucket === evidenceBucket) {
    throw new Error('direct_image_upload_configuration_invalid');
  }
  for (const value of [storage.endpoint, storage.publicUrl!]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('direct_image_upload_https_required');
    }
  }
  if (!/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/i.test(new URL(storage.endpoint).hostname)) {
    throw new Error('direct_image_upload_r2_endpoint_required');
  }
  return {
    protocol: 'r2-direct-v1' as const,
    storage,
    intakeStorage: { ...storage, bucket: intakeBucket, publicUrl: undefined } satisfies S3ObjectStorageConfig,
    intakeBucket,
    workerSecret,
  };
}

export function getDirectImageUploadCapability() {
  try {
    return { protocol: 'r2-direct-v1' as const, enabled: Boolean(getDirectImageUploadConfiguration()) };
  } catch {
    // Other application features and legacy uploads remain available on a bad opt-in.
    return { protocol: 'r2-direct-v1' as const, enabled: false };
  }
}

function requireConfiguration() {
  // A rollout rollback stops new uploads, but must not strand private objects.
  const config = getDirectImageUploadConfiguration({ ignoreEnabled: true });
  if (!config) throw new Error('direct_image_uploads_disabled');
  return config;
}

function assertJob(job: DirectImageObjectJob) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.id) || job.sourceKey !== `intake/v1/${job.id}.jpg`) {
    throw new Error('invalid_image_upload_object_key');
  }
}

function stagedKey(job: DirectImageObjectJob, variant: DirectImageVariant) {
  assertJob(job);
  const key = job[`${variant}Key`];
  const extension = getDirectImageVariantMediaType(job, variant) === 'image/jpeg' ? 'jpg' : 'webp';
  const prefix = `staged/v1/${job.id}/`;
  const suffix = `/${variant}.${extension}`;
  if (!key?.startsWith(prefix) || !key.endsWith(suffix) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(key.slice(prefix.length, -suffix.length))) {
    throw new Error('invalid_image_upload_object_key');
  }
  return key;
}

function publicKey(job: DirectImageObjectJob, variant: DirectImageVariant) {
  assertJob(job);
  if (!Number.isFinite(job.createdAt.getTime())) throw new Error('invalid_image_upload_date');
  const year = job.createdAt.getUTCFullYear();
  const month = String(job.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const extension = getDirectImageVariantMediaType(job, variant) === 'image/jpeg' ? 'jpg' : 'webp';
  return `listings/${year}/${month}/${job.id}${variant === 'original' ? '' : `-${variant}`}.${extension}`;
}

export function getDirectImagePublicUrls(job: DirectImageObjectJob) {
  const { storage } = requireConfiguration();
  const base = storage.publicUrl!.replace(/\/+$/, '');
  return {
    originalUrl: `${base}/${publicKey(job, 'original')}`,
    displayUrl: `${base}/${publicKey(job, 'display')}`,
    thumbnailUrl: `${base}/${publicKey(job, 'thumbnail')}`,
  };
}

export function createDirectImageTransfer(job: DirectImageObjectJob) {
  assertJob(job);
  if (!getDirectImageUploadConfiguration()) throw new Error('direct_image_uploads_disabled');
  const expiresSeconds = Math.floor((job.expiresAt.getTime() - Date.now()) / 1000);
  if (expiresSeconds < 1) throw new Error('image_upload_expired');
  const { intakeStorage } = requireConfiguration();
  const request = createPresignedRequest({
    method: 'PUT', key: job.sourceKey, mediaType: 'image/jpeg', config: intakeStorage,
    // Bind the HTTP framing to the declared bytes; changing/omitting this
    // signed header invalidates the grant before R2 accepts a different size.
    // SHA-256 is still verified by the Worker; R2 does not support SHA256
    // FULL_OBJECT checksums, so do not invent an unsupported checksum header.
    cacheControl: 'private, no-store', additionalHeaders: {
      'If-None-Match': '*', 'Content-Length': String(job.sizeBytes),
    }, expiresSeconds,
  });
  return { url: request.uploadUrl.toString(), method: 'PUT' as const, headers: request.headers };
}

async function boundedBody(response: Response, maxBytes: number) {
  const declaredSize = response.headers.get('content-length');
  if (declaredSize && Number(declaredSize) > maxBytes) {
    await response.body?.cancel();
    throw new Error('image_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('image_upload_empty_response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > maxBytes) throw new Error('image_too_large');
      chunks.push(item.value);
    }
  } finally { await reader.cancel(); }
  return new Uint8Array(Buffer.concat(chunks));
}

async function objectRequest<T>(config: S3ObjectStorageConfig, method: 'GET' | 'PUT' | 'DELETE' | 'HEAD', key: string,
  headers: Record<string, string>, consume: (response: Response) => Promise<T>, deadline?: number) {
  const budget = Math.min(30_000, deadline === undefined ? 30_000 : deadline - Date.now());
  if (budget <= 0) throw new DOMException('Image storage deadline reached.', 'TimeoutError');
  return retryImageStorage(async remaining => {
    const request = createPresignedRequest({ method, key, config,
      mediaType: headers['Content-Type'], additionalHeaders: headers });
    const response = await fetch(request.uploadUrl, {
      method, headers: request.headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(remaining),
    });
    try { return await consume(response); } finally { await response.body?.cancel().catch(() => undefined); }
  }, budget);
}

export async function readProcessedImage(job: DirectImageObjectJob, variant: DirectImageVariant) {
  const { intakeStorage } = requireConfiguration();
  return objectRequest(intakeStorage, 'GET', stagedKey(job, variant), {}, async response => {
    if (!response.ok) throw new ImageStorageResponseError(response.status);
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim();
    if (mediaType !== getDirectImageVariantMediaType(job, variant)) throw new Error('image_type_mismatch');
    const data = await boundedBody(response, maxImageBytes);
    if (!data.length) throw new Error('image_upload_empty_response');
    return { data, mediaType, etag: response.headers.get('etag') };
  });
}

/** Staged objects remain private. Only the server can copy them to public storage. */
export async function promoteProcessedImages(job: DirectImageObjectJob) {
  const { intakeStorage, storage } = requireConfiguration();
  // The database transaction has a 120s limit. Keep all copy/head operations
  // within one 90s I/O budget, including ambiguous-response verification.
  const deadline = Date.now() + 90_000;
  for (const variant of ['original', 'display', 'thumbnail'] as const) {
    const source = stagedKey(job, variant);
    const etag = await objectRequest(intakeStorage, 'HEAD', source, {}, async response => {
      if (!response.ok) throw new ImageStorageResponseError(response.status);
      const contentLength = Number(response.headers.get('content-length'));
      if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxImageBytes ||
        response.headers.get('content-type')?.split(';')[0].trim() !== getDirectImageVariantMediaType(job, variant)) {
        throw new Error('invalid_processed_image');
      }
      const value = response.headers.get('etag');
      if (!value) throw new Error('image_upload_missing_etag');
      return value;
    }, deadline);
    await objectRequest(storage, 'PUT', publicKey(job, variant), {
      'Content-Type': getDirectImageVariantMediaType(job, variant),
      'Cache-Control': finalCacheControl,
      'x-amz-copy-source': `/${intakeStorage.bucket}/${source}`,
      'x-amz-copy-source-if-match': etag,
      'x-amz-metadata-directive': 'REPLACE',
      // Create-once delivery URLs retain their immutable cache meaning across retries.
      'cf-copy-destination-if-none-match': '*',
    }, async response => {
      if (response.status === 412) {
        // An earlier attempt can have committed despite a lost response. Check
        // that the immutable destination matches this source before accepting it.
        await objectRequest(storage, 'HEAD', publicKey(job, variant), {}, async existing => {
          if (!existing.ok || existing.headers.get('etag') !== etag) throw new Error('image_upload_destination_conflict');
        }, deadline);
        return;
      }
      if (!response.ok) throw new ImageStorageResponseError(response.status);
      const body = Buffer.from(await boundedBody(response, 64 * 1024)).toString('utf8');
      if (/<(?:\w+:)?Error[\s>]/.test(body) || !/<(?:\w+:)?CopyObjectResult[\s>]/.test(body)) {
        throw new ImageStorageResponseError(503);
      }
    }, deadline);
  }
  return getDirectImagePublicUrls(job);
}

/** Never remove a finalized public image after an ambiguous transaction result. */
export async function discardDirectImageObjects(job: DirectImageObjectJob, options: { includePublic?: boolean } = {}) {
  assertJob(job);
  const { intakeStorage } = requireConfiguration();
  const keys = [job.sourceKey];
  for (const variant of ['original', 'display', 'thumbnail'] as const) {
    if (job[`${variant}Key`]) keys.push(stagedKey(job, variant));
  }
  const pending = keys.map(key => objectRequest(intakeStorage, 'DELETE', key, {}, async response => {
    if (!response.ok && response.status !== 404) throw new ImageStorageResponseError(response.status);
  }));
  if (options.includePublic) {
    pending.push((async () => {
      // A failed DB response does not establish that the transaction rolled back.
      const attached = await prisma.listingImage.findUnique({ where: { id: job.id }, select: { id: true } });
      if (!attached) {
        const removed = await deleteListingObject({ imageId: job.id,
          urls: Object.values(getDirectImagePublicUrls(job)), requireCachePurge: true });
        if (!removed) throw new Error('image_delivery_cleanup_incomplete');
      }
    })());
  }
  // Public deletion and private cleanup have independent protections and can
  // run together, so a stalled provider cannot double the maintenance budget.
  const outcomes = await Promise.allSettled(pending);
  if (outcomes.some(outcome => outcome.status === 'rejected')) {
    incrementRuntimeCounter('image.intake_cleanup.incomplete');
  }
  return outcomes.every(outcome => outcome.status === 'fulfilled');
}
