import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';

type StoreListingObjectInput = {
  data: Uint8Array;
  mediaType: string;
  imageId: string;
  fileName?: string;
};

type DeleteListingObjectInput = {
  imageId: string;
};

type S3ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicUrl?: string;
};

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
    'image/gif': 'gif',
  };
  const extension = fileName ? path.extname(fileName).replace('.', '') : '';

  return extensionByType[mediaType] ?? extension.toLowerCase() ?? 'bin';
}

function createObjectKey(input: StoreListingObjectInput) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `listings/${year}/${month}/${input.imageId}.${getExtension(
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

function createPresignedPutRequest({
  key,
  mediaType,
  config,
}: {
  key: string;
  mediaType: string;
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
  const signedHeaders = 'host';
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
  const canonicalHeaders = [
    `host:${uploadUrl.host}`,
    '',
  ].join('\n');
  const canonicalRequest = [
    'PUT',
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
    headers: {
      'Content-Type': mediaType,
    },
  };
}

async function storeListingObjectInS3(input: StoreListingObjectInput) {
  const config = getS3ObjectStorageConfig();
  const body = Buffer.from(input.data);
  const key = createObjectKey(input);
  const request = createPresignedPutRequest({
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

export async function deleteListingObject(_input: DeleteListingObjectInput) {
  void _input;

  if (!isObjectStorageEnabled()) {
    return false;
  }

  const missingConfig = getMissingObjectStorageConfig();

  if (missingConfig.length) {
    throw new Error(
      `Missing object storage configuration: ${missingConfig.join(', ')}`,
    );
  }

  return false;
}
