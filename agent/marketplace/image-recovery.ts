import { createHash } from 'node:crypto';
import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { ImageStorageResponseError, retryImageStorage } from './image-storage-retry';
import type { createPresignedRequest, S3ObjectStorageConfig } from './object-storage';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Infrastructure opt-in. A retained copy must never use a public/intake/evidence bucket. */
export function getImageRecoveryConfig(source: S3ObjectStorageConfig) {
  const bucket = process.env.SMARTSTORE_IMAGE_RECOVERY_BUCKET?.trim();
  if (!bucket) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      [source.bucket, process.env.SMARTSTORE_IMAGE_INTAKE_BUCKET?.trim(),
        process.env.SMARTSTORE_EVIDENCE_STORAGE_BUCKET?.trim()].includes(bucket)) {
    throw new Error('private_image_recovery_bucket_required');
  }
  return { ...source, bucket, publicUrl: undefined };
}

export function imageRecoveryKey(sourceBucket: string, key: string) {
  if (!/^(?:listings|profiles)\/[a-zA-Z0-9_./-]+\.(?:webp|jpe?g|png)$/.test(key) ||
      key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('invalid_image_recovery_source');
  }
  return `recovery/v1/${hash(sourceBucket).slice(0, 16)}/${key}`;
}

async function assertCopyResult(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('image_recovery_copy_unconfirmed');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65_536) throw new Error('image_recovery_copy_unconfirmed');
      parts.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const xml = Buffer.concat(parts).toString('utf8');
  // CopyObject can embed an Error in HTTP200; accepting status alone loses data.
  if (/<(?:[\w-]+:)?Error(?:\s|>)/i.test(xml) ||
      !/<(?:[\w-]+:)?CopyObjectResult(?:\s|>)/.test(xml) ||
      !/<(?:[\w-]+:)?ETag>[^<]+<\//.test(xml)) {
    throw new Error('image_recovery_copy_unconfirmed');
  }
}

/** Archive all committed delivery objects before deleting any public sibling.
 * No upload-source/master is created here. Failed/abandoned uploads opt out.
 * Failure leaves the durable cleanup job pending instead of bypassing recovery.
 */
export async function archiveRecoverableImageObjects(input: {
  source: S3ObjectStorageConfig; keys: string[]; deadline?: number;
  sign: typeof createPresignedRequest;
}) {
  const recovery = getImageRecoveryConfig(input.source);
  if (!recovery) return;
  const deadline = Math.min(input.deadline ?? Date.now() + 20_000, Date.now() + 20_000);
  function budget() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DOMException('Recovery copy deadline reached.', 'TimeoutError');
    return remaining;
  }
  // A single image has only its distinct referenced variants; bounded by caller.
  await Promise.all(input.keys.map(async key => {
    const destination = imageRecoveryKey(input.source.bucket, key);
    const sourceHash = hash(`${input.source.bucket}/${key}`);
    await retryImageStorage(async () => {
      const sourceHead = input.sign({ method: 'HEAD', key, config: input.source });
      const source = await fetchWithTimeout(sourceHead.uploadUrl, {
        method: 'HEAD', headers: sourceHead.headers, redirect: 'error',
      }, budget());
      if (source.status === 404) {
        // The earlier copy/delete may have committed before its reply was lost.
        const existing = input.sign({ method: 'HEAD', key: destination, config: recovery });
        const saved = await fetchWithTimeout(existing.uploadUrl, {
          method: 'HEAD', headers: existing.headers, redirect: 'error',
        }, budget());
        const savedSize = Number(saved.headers.get('x-amz-meta-source-size'));
        if (saved.ok && saved.headers.get('x-amz-meta-source-hash') === sourceHash &&
            Number.isSafeInteger(savedSize) && savedSize > 0 &&
            Number(saved.headers.get('content-length')) === savedSize) return;
        throw new Error('image_recovery_source_missing');
      }
      if (!source.ok) throw new ImageStorageResponseError(source.status);
      const sourceSize = Number(source.headers.get('content-length'));
      if (!Number.isSafeInteger(sourceSize) || sourceSize <= 0) throw new Error('invalid_image_recovery_source');
      const request = input.sign({ method: 'PUT', key: destination, config: recovery,
        mediaType: source.headers.get('content-type') ?? 'application/octet-stream',
        cacheControl: 'private, no-store', additionalHeaders: {
          'x-amz-copy-source': '/' + [input.source.bucket, ...key.split('/')].map(encodeURIComponent).join('/'),
          ...(source.headers.get('etag') ? { 'x-amz-copy-source-if-match': source.headers.get('etag')! } : {}),
          'x-amz-metadata-directive': 'REPLACE',
          'x-amz-meta-source-hash': sourceHash,
          'x-amz-meta-source-size': String(sourceSize),
        } });
      const copied = await fetchWithTimeout(request.uploadUrl, {
        method: 'PUT', headers: request.headers, redirect: 'error',
      }, budget());
      if (!copied.ok) {
        await copied.body?.cancel();
        throw new ImageStorageResponseError(copied.status);
      }
      await assertCopyResult(copied);
      const verification = input.sign({ method: 'HEAD', key: destination, config: recovery });
      const verified = await fetchWithTimeout(verification.uploadUrl, {
        method: 'HEAD', headers: verification.headers, redirect: 'error',
      }, budget());
      if (!verified.ok || verified.headers.get('x-amz-meta-source-hash') !== sourceHash ||
          Number(verified.headers.get('content-length')) !== sourceSize) {
        throw new Error('image_recovery_verification_failed');
      }
    }, budget());
  }));
}
