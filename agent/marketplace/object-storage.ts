import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';

type StoreListingObjectInput = {
  data: Uint8Array;
  mediaType: string;
  imageId: string;
  fileName?: string;
  objectPrefix?: 'listings' | 'profiles';
  variant?: 'original' | 'display' | 'thumbnail';
};

type DeleteListingObjectInput = {
  imageId: string;
  urls?: string[];
};

type S3ObjectStorageConfig = {
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

class CloudflareCachePurgeError extends Error {
  constructor(readonly status: number, readonly codes: number[]) {
    super('Cloudflare rejected the cache purge request.');
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

function getS3ObjectStorageConfig(): S3ObjectStorageConfig {
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

  return `${input.objectPrefix ?? 'listings'}/${year}/${month}/${input.imageId}${variantSuffix}.${getExtension(
    input.mediaType,
    input.fileName,
  )}`;
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

function buildPublicUrl(config: S3ObjectStorageConfig, key: string, uploadUrl: URL) {
  if (!config.publicUrl) {
    return uploadUrl.toString();
  }

  return `${config.publicUrl.replace(/\/$/, '')}/${key}`;
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

async function getStorageResponseText(response: Response) {
  try {
    return (await response.text()).replace(/\s+/g, ' ').slice(0, 500);
  } catch {
    return '';
  }
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

function createPresignedRequest({
  method,
  key,
  mediaType,
  config,
}: {
  method: 'PUT' | 'DELETE';
  key: string;
  mediaType?: string;
  config: S3ObjectStorageConfig;
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
  const requestHeaders: Record<string, string> =
    method === 'PUT'
      ? {
          'Cache-Control': listingObjectCacheControl,
          'Content-Type': mediaType ?? 'application/octet-stream',
        }
      : {};
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
    ['X-Amz-Expires', '300'],
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
  const request = createPresignedRequest({
    method: 'PUT',
    key,
    mediaType: input.mediaType,
    config,
  });
  let response: Response;

  try {
    response = await fetchWithTimeout(
      request.uploadUrl,
      {
        method: 'PUT',
        headers: request.headers,
        body,
      },
      getObjectStorageTimeoutMs(),
    );
  } catch (error) {
    throw new Error(
      `Object storage upload request failed for ${request.uploadUrl.host}${request.uploadUrl.pathname}: ${formatErrorForLog(error)}.`,
    );
  }

  if (!response.ok) {
    const responseText = await getStorageResponseText(response);

    throw new Error(
      `Object storage upload failed with status ${response.status}${
        responseText ? `: ${responseText}` : ''
      }.`,
    );
  }

  return {
    key,
    url: buildPublicUrl(config, key, request.uploadUrl),
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

async function deleteStoredObjectKey(config: S3ObjectStorageConfig, key: string) {
  const request = createPresignedRequest({
    method: 'DELETE',
    key,
    config,
  });
  let response: Response;

  try {
    response = await fetchWithTimeout(
      request.uploadUrl,
      {
        method: 'DELETE',
        headers: request.headers,
      },
      getObjectStorageTimeoutMs(),
    );
  } catch (error) {
    throw new Error(
      `Object storage delete request failed for ${request.uploadUrl.host}${request.uploadUrl.pathname}: ${formatErrorForLog(error)}.`,
    );
  }

  if (!response.ok && response.status !== 404) {
    const responseText = await getStorageResponseText(response);

    throw new Error(
      `Object storage delete failed with status ${response.status}${
        responseText ? `: ${responseText}` : ''
      }.`,
    );
  }
}

async function purgeCloudflareCacheByUrls(urls: string[]) {
  const config = getCloudflareCachePurgeConfig();

  if (!config || urls.length === 0) {
    return false;
  }

  const response = await fetchWithTimeout(
    `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
    },
    getCloudflareCachePurgeTimeoutMs(),
  );

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const errors = payload && typeof payload === 'object' && 'errors' in payload
      ? payload.errors : null;
    // Log only numeric provider codes, never raw bodies, headers, URLs or tokens.
    const codes = Array.isArray(errors) ? errors.flatMap((error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error)) return [];
      return typeof error.code === 'number' && Number.isSafeInteger(error.code)
        ? [error.code] : [];
    }).slice(0, 10) : [];
    throw new CloudflareCachePurgeError(response.status, codes);
  }

  return true;
}

async function purgeCloudflareCacheBestEffort(urls: string[]) {
  try {
    await purgeCloudflareCacheByUrls(urls);
  } catch (error) {
    if (error instanceof CloudflareCachePurgeError) {
      console.warn(`[cloudflare_cache_purge] failure=provider_rejected status=${error.status} codes=${error.codes.join(',') || 'none'}`);
    } else {
      const errorName = error instanceof Error &&
        ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error.name)
        ? error.name : 'UnknownError';
      console.warn(`[cloudflare_cache_purge] failure=${errorName}`);
    }
  }
}

export async function deleteListingObject(input: DeleteListingObjectInput) {
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

  await Promise.all([...keys].map((key) => deleteStoredObjectKey(config, key)));
  await purgeCloudflareCacheBestEffort([...purgeUrls]);

  return true;
}
