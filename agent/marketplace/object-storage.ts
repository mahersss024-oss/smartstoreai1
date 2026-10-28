import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { prisma } from '@/lib/db/prisma';
import { incrementRuntimeCounter } from '@/lib/observability/runtime-metrics';
import { ImageStorageResponseError, retryImageStorage } from './image-storage-retry';

type StoreListingObjectInput = {
  data: Uint8Array;
  mediaType: string;
  imageId: string;
  fileName?: string;
  objectPrefix?: 'listings' | 'profiles';
  profileOwnerId?: string;
  variant?: 'original' | 'display' | 'thumbnail';
};

type DeleteListingObjectInput = {
  imageId: string;
  urls?: string[];
  requireCachePurge?: boolean;
  deadline?: number;
};

export type S3ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicUrl?: string;
};

type CloudflareCachePurgeConfig = {
  apiToken: string;
  zoneId: string;
};

class CloudflareCachePurgeError extends ImageStorageResponseError {
  constructor(status: number, readonly codes: number[]) {
    super(status);
    this.name = 'CloudflareCachePurgeError';
  }
}

function getObjectStorageMode() {
  return process.env.SMARTSTORE_IMAGE_STORAGE?.trim().toLowerCase();
}

function isObjectStorageEnabled() {
  const mode = getObjectStorageMode();

  return mode === 'object' || mode === 's3';
}

function getObjectStorageTimeoutMs() {
  const rawValue = process.env.SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 30_000;

  if (!Number.isFinite(parsedValue)) {
    return 30_000;
  }

  return Math.min(Math.max(parsedValue, 1_000), 60_000);
}

export function getS3ObjectStorageConfig(): S3ObjectStorageConfig {
  return {
    endpoint: process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT?.trim() ?? '',
    bucket: process.env.SMARTSTORE_OBJECT_STORAGE_BUCKET?.trim() ?? '',
    accessKeyId:
      process.env.SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey:
      process.env.SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? '',
    region: process.env.SMARTSTORE_OBJECT_STORAGE_REGION?.trim() || 'auto',
    publicUrl: process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL?.trim(),
  };
}

export function getMissingObjectStorageConfig() {
  if (!isObjectStorageEnabled()) {
    return [];
  }

  const s3Config = getS3ObjectStorageConfig();

  return [
    ['SMARTSTORE_OBJECT_STORAGE_ENDPOINT', s3Config.endpoint],
    ['SMARTSTORE_OBJECT_STORAGE_BUCKET', s3Config.bucket],
    ['SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID', s3Config.accessKeyId],
    ['SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY', s3Config.secretAccessKey],
    ['SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL', s3Config.publicUrl],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function sha256Hex(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function getAmzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function getDateStamp(amzDate: string) {
  return amzDate.slice(0, 8);
}

function getExtension(mediaType: string, fileName?: string) {
  const extensionByType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const extension = fileName ? path.extname(fileName).replace('.', '') : '';

  return extensionByType[mediaType] ?? extension.toLowerCase() ?? 'bin';
}

function createObjectKey(input: StoreListingObjectInput) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const variantSuffix =
    input.variant && input.variant !== 'original' ? `-${input.variant}` : '';

  const prefix = input.objectPrefix === 'profiles' && input.profileOwnerId
    ? ownedProfileObjectPrefix(input.profileOwnerId) : input.objectPrefix ?? 'listings';
  return `${prefix}/${year}/${month}/${input.imageId}${variantSuffix}.${getExtension(
    input.mediaType,
    input.fileName,
  )}`;
}

function ownedProfileObjectPrefix(userId: string) {
  return `profiles/owners/${sha256Hex(`profile:${userId}`)}`;
}

/** Only server-generated, account-scoped profile objects grant deletion rights.
 * Legacy profile URLs and OAuth/provider pictures may still be displayed, but a
 * user-editable URL never proves who owns its stored bytes. */
export function isOwnedProfileImageUrl(userId: string, url: string) {
  try {
    const key = getStoredObjectKeyFromUrl(getS3ObjectStorageConfig(), url);
    if (!key) return false;
    const prefix = ownedProfileObjectPrefix(userId);
    return key.startsWith(`${prefix}/`) && /^\d{4}\/\d{2}\/[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)$/.test(key.slice(prefix.length + 1));
  } catch { return false; }
}

export function isConfiguredImageObjectUrl(url: string) {
  try { return Boolean(getStoredObjectKeyFromUrl(getS3ObjectStorageConfig(), url)); }
  catch { return false; }
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildCanonicalQuery(params: Array<[string, string]>) {
  return params
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);

      return keyComparison || leftValue.localeCompare(rightValue);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function buildPublicUrl(config: S3ObjectStorageConfig, key: string) {
  if (!config.publicUrl) {
    throw new Error('Missing public image delivery URL.');
  }
  const url = new URL(config.publicUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid public image delivery URL.');
  }
  return `${url.toString().replace(/\/$/, '')}/${key}`;
}

const listingObjectCacheControl = 'public, max-age=31536000, immutable';

function formatErrorForLog(error: unknown) {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }

  const cause = error.cause;
  const causeParts: string[] = [];

  if (cause instanceof Error) {
    causeParts.push(cause.name, cause.message);
    const causeCode = (cause as { code?: unknown }).code;

    if (typeof causeCode === 'string' && causeCode) {
      causeParts.push(`code=${causeCode}`);
    }
  }

  return [error.name, error.message, causeParts.join(' ')]
    .filter(Boolean)
    .join(' / ')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function getSigningKey(config: S3ObjectStorageConfig, dateStamp: string) {
  if (!config.secretAccessKey) {
    throw new Error('Missing object storage secret access key.');
  }

  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');

  return hmac(serviceKey, 'aws4_request');
}

export function createPresignedRequest({
  method,
  key,
  mediaType,
  config,
  cacheControl = listingObjectCacheControl,
  additionalHeaders = {},
  expiresSeconds = 300,
}: {
  method: 'PUT' | 'DELETE' | 'GET' | 'HEAD';
  key: string;
  mediaType?: string;
  config: S3ObjectStorageConfig;
  cacheControl?: string;
  additionalHeaders?: Record<string, string>;
  expiresSeconds?: number;
}) {
  if (!config.endpoint || !config.bucket || !config.accessKeyId) {
    throw new Error('Missing object storage configuration.');
  }

  const endpoint = new URL(config.endpoint);
  const uploadUrl = new URL(
    `${endpoint.pathname.replace(/\/$/, '')}/${config.bucket}/${key}`,
    endpoint,
  );
  const amzDate = getAmzDate();
  const dateStamp = getDateStamp(amzDate);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;
  const requestHeaders: Record<string, string> = {
    ...(method === 'PUT'
      ? {
          'Cache-Control': cacheControl,
          'Content-Type': mediaType ?? 'application/octet-stream',
        }
      : {}),
    ...additionalHeaders,
  };
  const canonicalHeaderEntries = [
    ['host', uploadUrl.host],
    ...Object.entries(requestHeaders).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  ].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const signedHeaders = canonicalHeaderEntries
    .map(([key]) => key)
    .join(';');
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', payloadHash],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.min(300, Math.max(1, Math.floor(expiresSeconds))))],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const canonicalQuery = buildCanonicalQuery(queryParams);
  const canonicalUri = uploadUrl.pathname
    .split('/')
    .map((segment) => awsEncode(segment))
    .join('/');
  const canonicalHeaders = `${canonicalHeaderEntries
    .map(([key, value]) => `${key}:${String(value).trim()}`)
    .join('\n')}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(config, dateStamp), stringToSign);

  for (const [key, value] of queryParams) {
    uploadUrl.searchParams.set(key, value);
  }

  uploadUrl.searchParams.set('X-Amz-Signature', signature);

  return {
    uploadUrl,
    headers: requestHeaders,
  };
}

function getCloudflareCachePurgeConfig(): CloudflareCachePurgeConfig | null {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();

  if (!apiToken || !zoneId) {
    return null;
  }

  return { apiToken, zoneId };
}

function getCloudflareCachePurgeTimeoutMs() {
  const rawValue = process.env.CLOUDFLARE_CACHE_PURGE_TIMEOUT_MS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 10_000;

  if (!Number.isFinite(parsedValue)) {
    return 10_000;
  }

  return Math.min(Math.max(parsedValue, 1_000), 30_000);
}

async function storeListingObjectInS3(input: StoreListingObjectInput) {
  const config = getS3ObjectStorageConfig();
  const body = Buffer.from(input.data);
  const key = createObjectKey(input);
  const publicUrl = buildPublicUrl(config, key);
  const request = createPresignedRequest({
    method: 'PUT',
    key,
    mediaType: input.mediaType,
    config,
  });
  try {
    await retryImageStorage(async remainingMs => {
      const result = await fetchWithTimeout(request.uploadUrl, {
        method: 'PUT', headers: request.headers, body,
      }, remainingMs);
      if (!result.ok) {
        await result.body?.cancel();
        throw new ImageStorageResponseError(result.status);
      }
      return result;
    }, getObjectStorageTimeoutMs());
  } catch (error) {
    incrementRuntimeCounter('image.storage.failed', { operation: 'upload' });
    throw new Error(
      `Object storage upload request failed for ${request.uploadUrl.host}${request.uploadUrl.pathname}: ${formatErrorForLog(error)}.`,
    );
  }

  return {
    key,
    url: publicUrl,
  };
}

export async function storeListingObject(input: StoreListingObjectInput) {
  if (!isObjectStorageEnabled()) {
    return null;
  }

  const missingConfig = getMissingObjectStorageConfig();

  if (missingConfig.length) {
    throw new Error(
      `Missing object storage configuration: ${missingConfig.join(', ')}`,
    );
  }

  return storeListingObjectInS3(input);
}

function getEvidenceStorageConfig() {
  const config = getS3ObjectStorageConfig();
  const bucket = process.env.SMARTSTORE_EVIDENCE_STORAGE_BUCKET?.trim();
  if (!bucket || bucket === config.bucket) throw new Error('private_evidence_bucket_required');
  return { ...config, bucket, publicUrl: undefined };
}

async function readEvidenceBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_evidence_source');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 20 * 1024 * 1024) throw new Error('evidence_source_too_large');
      parts.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}

export async function readEvidenceSource(sourceUrl: string) {
  if (/^data:image\/(jpeg|png|webp);base64,/.test(sourceUrl)) {
    const [header, encoded] = sourceUrl.split(',', 2);
    if (encoded.length > Math.ceil(20 * 1024 * 1024 * 4 / 3)) throw new Error('evidence_source_too_large');
    const data = Buffer.from(encoded, 'base64');
    if (data.length > 20 * 1024 * 1024) throw new Error('evidence_source_too_large');
    return { data, mediaType: header.slice(5, -7) };
  }
  const config = getS3ObjectStorageConfig();
  const key = getStoredObjectKeyFromUrl(config, sourceUrl);
  if (!key || !key.startsWith('listings/') || key.split('/').some(part => part === '..')) {
    throw new Error('untrusted_evidence_source');
  }
  // Read through authenticated storage, never fetch an arbitrary URL from a report.
  const request = createPresignedRequest({ method: 'GET', key, config });
  const response = await fetch(request.uploadUrl, { redirect: 'error', signal: AbortSignal.timeout(getObjectStorageTimeoutMs()) });
  if (!response.ok) throw new Error(`evidence_source_http_${response.status}`);
  const mediaType = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) throw new Error('invalid_evidence_image');
  return { data: await readEvidenceBody(response), mediaType };
}

export async function storeEvidenceObject(key: string, data: Buffer, mediaType: string) {
  const config = getEvidenceStorageConfig();
  const request = createPresignedRequest({ method: 'PUT', key, mediaType, config, cacheControl: 'private, no-store' });
  const response = await fetchWithTimeout(request.uploadUrl, { method: 'PUT', headers: request.headers, body: new Uint8Array(data) }, getObjectStorageTimeoutMs());
  if (!response.ok) throw new Error('evidence_upload_failed');
}

export async function readEvidenceObject(key: string) {
  const request = createPresignedRequest({ method: 'GET', key, config: getEvidenceStorageConfig() });
  const response = await fetch(request.uploadUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(getObjectStorageTimeoutMs()) });
  if (!response.ok) throw new Error('evidence_read_failed');
  return readEvidenceBody(response);
}

export async function deleteEvidenceObject(key: string) {
  await deleteStoredObjectKey(getEvidenceStorageConfig(), key);
}

function getStoredObjectKeyFromUrl(config: S3ObjectStorageConfig, urlValue: string) {
  if (!urlValue) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  if (config.publicUrl) {
    const publicUrl = new URL(config.publicUrl);
    const publicPathPrefix = publicUrl.pathname.replace(/\/$/, '');

    if (url.origin === publicUrl.origin) {
      const path = decodeURIComponent(url.pathname);

      if (!publicPathPrefix || path.startsWith(`${publicPathPrefix}/`)) {
        return path.slice(publicPathPrefix.length + 1).replace(/^\/+/, '');
      }
    }
  }

  const endpoint = new URL(config.endpoint);
  const endpointPathPrefix = endpoint.pathname.replace(/\/$/, '');
  const bucketPrefix = `${endpointPathPrefix}/${config.bucket}`.replace(
    /\/+/g,
    '/',
  );
  const path = decodeURIComponent(url.pathname);

  if (url.host === endpoint.host && path.startsWith(`${bucketPrefix}/`)) {
    return path.slice(bucketPrefix.length + 1).replace(/^\/+/, '');
  }

  return null;
}

function deletionBudget(maximum: number, deadline?: number) {
  const remaining = deadline === undefined ? maximum : Math.min(maximum, deadline - Date.now());
  if (remaining <= 0) throw new DOMException('Image cleanup deadline reached.', 'TimeoutError');
  return remaining;
}

async function deleteStoredObjectKey(config: S3ObjectStorageConfig, key: string, deadline?: number) {
  const request = createPresignedRequest({
    method: 'DELETE',
    key,
    config,
  });
  try {
    await retryImageStorage(async remainingMs => {
      const result = await fetchWithTimeout(request.uploadUrl, {
        method: 'DELETE', headers: request.headers,
      }, remainingMs);
      if (!result.ok && result.status !== 404) {
        await result.body?.cancel();
        throw new ImageStorageResponseError(result.status);
      }
      return result;
    }, deletionBudget(getObjectStorageTimeoutMs(), deadline));
  } catch (error) {
    incrementRuntimeCounter('image.storage.failed', { operation: 'delete' });
    throw new Error(
      `Object storage delete request failed for ${request.uploadUrl.host}${request.uploadUrl.pathname}: ${formatErrorForLog(error)}.`,
    );
  }
}

async function purgeCloudflareCacheByUrls(urls: string[], deadline?: number) {
  const config = getCloudflareCachePurgeConfig();

  if (urls.length === 0) {
    return false;
  }
  if (!config) {
    incrementRuntimeCounter('image.cache_purge.incomplete', { reason: 'missing_config' });
    console.warn('[cloudflare_cache_purge] outcome=incomplete reason=missing_config');
    return false;
  }

  return retryImageStorage(async remainingMs => {
    // Keep this signal attached while reading JSON too. A headers-only timeout
    // would leave a stalled provider response body outside the retry budget.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out.', 'TimeoutError')), remainingMs);
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: urls }),
          signal: controller.signal,
        },
      );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof SyntaxError) payload = null;
        else throw error;
      }
      if (response.ok && payload && typeof payload === 'object' &&
        'success' in payload && payload.success === true) {
        incrementRuntimeCounter('image.cache_purge.completed');
        return true;
      }
      const errors = payload && typeof payload === 'object' && 'errors' in payload
        ? payload.errors : null;
      // Log only numeric provider codes, never raw bodies, headers, URLs or tokens.
      const codes = Array.isArray(errors) ? errors.flatMap((error: unknown) => {
        if (!error || typeof error !== 'object' || !('code' in error)) return [];
        return typeof error.code === 'number' && Number.isSafeInteger(error.code)
          ? [error.code] : [];
      }).slice(0, 10) : [];
      throw new CloudflareCachePurgeError(response.status, codes);
    } finally {
      clearTimeout(timeout);
    }
  }, deletionBudget(getCloudflareCachePurgeTimeoutMs(), deadline));
}

async function purgeCloudflareCacheBestEffort(urls: string[], deadline?: number) {
  try {
    return await purgeCloudflareCacheByUrls(urls, deadline);
  } catch (error) {
    incrementRuntimeCounter('image.cache_purge.incomplete', { reason: 'provider_failure' });
    if (error instanceof CloudflareCachePurgeError) {
      console.warn(`[cloudflare_cache_purge] failure=provider_rejected status=${error.status} codes=${error.codes.join(',') || 'none'}`);
    } else {
      const errorName = error instanceof Error &&
        ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error.name)
        ? error.name : 'UnknownError';
      console.warn(`[cloudflare_cache_purge] failure=${errorName}`);
    }
    return false;
  }
}

export async function deleteListingObject(input: DeleteListingObjectInput) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE === 'database' && input.urls?.length && await prisma.evidenceAsset.count({
    where: { sourceHash: { in: input.urls.map(sha256Hex) }, status: { not: 'stored' }, evidenceCase: { status: { not: 'disposed' } } },
  })) throw new Error('evidence_copy_pending');
  if (!isObjectStorageEnabled()) {
    return false;
  }

  const missingConfig = getMissingObjectStorageConfig();

  if (missingConfig.length) {
    throw new Error(
      `Missing object storage configuration: ${missingConfig.join(', ')}`,
    );
  }

  const config = getS3ObjectStorageConfig();
  const keys = new Set<string>();
  const purgeUrls = new Set<string>();

  for (const url of input.urls ?? []) {
    const key = getStoredObjectKeyFromUrl(config, url);

    if (key) {
      keys.add(key);
      purgeUrls.add(url);
    }
  }

  if (!keys.size) {
    return false;
  }

  // A failed sibling delete must not skip invalidating objects already removed.
  const deletions = await Promise.allSettled([...keys].map((key) => deleteStoredObjectKey(config, key, input.deadline)));
  const purged = await purgeCloudflareCacheBestEffort([...purgeUrls], input.deadline);
  const failure = deletions.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  if (input.requireCachePurge && !purged) return false;

  return true;
}
