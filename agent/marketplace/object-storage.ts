import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

const objectStorageMode = process.env.SMARTSTORE_IMAGE_STORAGE?.trim();
const objectStorageEndpoint =
  process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT?.trim();
const objectStorageBucket =
  process.env.SMARTSTORE_OBJECT_STORAGE_BUCKET?.trim();
const objectStorageAccessKeyId =
  process.env.SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
const objectStorageSecretAccessKey =
  process.env.SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
const objectStorageRegion =
  process.env.SMARTSTORE_OBJECT_STORAGE_REGION?.trim() || 'auto';
const objectStoragePublicUrl =
  process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL?.trim();

type StoreListingObjectInput = {
  data: Uint8Array;
  mediaType: string;
  imageId: string;
  fileName?: string;
};

function isObjectStorageEnabled() {
  return objectStorageMode === 'object' || objectStorageMode === 's3';
}

export function getMissingObjectStorageConfig() {
  if (!isObjectStorageEnabled()) {
    return [];
  }

  return [
    ['SMARTSTORE_OBJECT_STORAGE_ENDPOINT', objectStorageEndpoint],
    ['SMARTSTORE_OBJECT_STORAGE_BUCKET', objectStorageBucket],
    ['SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID', objectStorageAccessKeyId],
    ['SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY', objectStorageSecretAccessKey],
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

  return `listings/${year}/${month}/${input.imageId}.${getExtension(
    input.mediaType,
    input.fileName,
  )}`;
}

function buildPublicUrl(key: string, uploadUrl: URL) {
  if (!objectStoragePublicUrl) {
    return uploadUrl.toString();
  }

  return `${objectStoragePublicUrl.replace(/\/$/, '')}/${key}`;
}

function getSigningKey(dateStamp: string) {
  if (!objectStorageSecretAccessKey) {
    throw new Error('Missing object storage secret access key.');
  }

  const dateKey = hmac(`AWS4${objectStorageSecretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, objectStorageRegion);
  const serviceKey = hmac(regionKey, 's3');

  return hmac(serviceKey, 'aws4_request');
}

function createSignedPutRequest({
  body,
  key,
  mediaType,
}: {
  body: Buffer;
  key: string;
  mediaType: string;
}) {
  if (
    !objectStorageEndpoint ||
    !objectStorageBucket ||
    !objectStorageAccessKeyId
  ) {
    throw new Error('Missing object storage configuration.');
  }

  const endpoint = new URL(objectStorageEndpoint);
  const uploadUrl = new URL(
    `${endpoint.pathname.replace(/\/$/, '')}/${objectStorageBucket}/${key}`,
    endpoint,
  );
  const amzDate = getAmzDate();
  const dateStamp = getDateStamp(amzDate);
  const payloadHash = sha256Hex(body);
  const canonicalUri = uploadUrl.pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const canonicalHeaders = [
    `content-type:${mediaType}`,
    `host:${uploadUrl.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n');
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${objectStorageRegion}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(dateStamp), stringToSign);
  const authorization = [
    'AWS4-HMAC-SHA256',
    `Credential=${objectStorageAccessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  return {
    uploadUrl,
    headers: {
      Authorization: authorization,
      'Content-Type': mediaType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
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

  const body = Buffer.from(input.data);
  const key = createObjectKey(input);
  const request = createSignedPutRequest({
    body,
    key,
    mediaType: input.mediaType,
  });
  const response = await fetch(request.uploadUrl, {
    method: 'PUT',
    headers: request.headers,
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Object storage upload failed with status ${response.status}.`,
    );
  }

  return {
    key,
    url: buildPublicUrl(key, request.uploadUrl),
  };
}
