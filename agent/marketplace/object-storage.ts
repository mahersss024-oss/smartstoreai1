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

type CloudinaryStorageConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
};

function getObjectStorageMode() {
  return process.env.SMARTSTORE_IMAGE_STORAGE?.trim().toLowerCase();
}

function isObjectStorageEnabled() {
  const mode = getObjectStorageMode();

  return mode === 'object' || mode === 's3' || mode === 'cloudinary';
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

function getCloudinaryStorageConfig(): CloudinaryStorageConfig {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY?.trim() ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() ?? '',
    folder:
      process.env.CLOUDINARY_FOLDER?.trim() || 'smartstore/listings',
  };
}

export function getMissingObjectStorageConfig() {
  if (!isObjectStorageEnabled()) {
    return [];
  }

  if (getObjectStorageMode() === 'cloudinary') {
    const cloudinaryConfig = getCloudinaryStorageConfig();

    return [
      ['CLOUDINARY_CLOUD_NAME', cloudinaryConfig.cloudName],
      ['CLOUDINARY_API_KEY', cloudinaryConfig.apiKey],
      ['CLOUDINARY_API_SECRET', cloudinaryConfig.apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
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

function sha1Hex(value: string) {
  return createHash('sha1').update(value).digest('hex');
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

function buildPublicUrl(config: S3ObjectStorageConfig, key: string, uploadUrl: URL) {
  if (!config.publicUrl) {
    return uploadUrl.toString();
  }

  return `${config.publicUrl.replace(/\/$/, '')}/${key}`;
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

function createSignedPutRequest({
  body,
  key,
  mediaType,
  config,
}: {
  body: Buffer;
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
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(config, dateStamp), stringToSign);
  const authorization = [
    'AWS4-HMAC-SHA256',
    `Credential=${config.accessKeyId}/${credentialScope}`,
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

async function storeListingObjectInS3(input: StoreListingObjectInput) {
  const config = getS3ObjectStorageConfig();
  const body = Buffer.from(input.data);
  const key = createObjectKey(input);
  const request = createSignedPutRequest({
    body,
    key,
    mediaType: input.mediaType,
    config,
  });
  const response = await fetchWithTimeout(
    request.uploadUrl,
    {
      method: 'PUT',
      headers: request.headers,
      body,
    },
    getObjectStorageTimeoutMs(),
  );

  if (!response.ok) {
    throw new Error(
      `Object storage upload failed with status ${response.status}.`,
    );
  }

  return {
    key,
    url: buildPublicUrl(config, key, request.uploadUrl),
  };
}

function createCloudinarySignature(
  params: Record<string, string | number>,
  apiSecret: string,
) {
  const payload = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return sha1Hex(`${payload}${apiSecret}`);
}

async function storeListingObjectInCloudinary(input: StoreListingObjectInput) {
  const config = getCloudinaryStorageConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const uploadParams = {
    folder: config.folder,
    public_id: input.imageId,
    timestamp,
  };
  const formData = new FormData();
  const arrayBuffer = input.data.buffer.slice(
    input.data.byteOffset,
    input.data.byteOffset + input.data.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: input.mediaType });

  formData.append(
    'file',
    blob,
    input.fileName ?? `${input.imageId}.${getExtension(input.mediaType)}`,
  );
  formData.append('api_key', config.apiKey);
  formData.append('folder', uploadParams.folder);
  formData.append('public_id', uploadParams.public_id);
  formData.append('timestamp', String(uploadParams.timestamp));
  formData.append(
    'signature',
    createCloudinarySignature(uploadParams, config.apiSecret),
  );

  const response = await fetchWithTimeout(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      config.cloudName,
    )}/image/upload`,
    {
      method: 'POST',
      body: formData,
    },
    getObjectStorageTimeoutMs(),
  );

  if (!response.ok) {
    throw new Error(`Cloudinary upload failed with status ${response.status}.`);
  }

  const result = (await response.json()) as {
    public_id?: unknown;
    secure_url?: unknown;
    url?: unknown;
  };
  const url =
    typeof result.secure_url === 'string'
      ? result.secure_url
      : typeof result.url === 'string'
        ? result.url
        : null;

  if (!url) {
    throw new Error('Cloudinary upload response is missing a secure URL.');
  }

  return {
    key:
      typeof result.public_id === 'string'
        ? result.public_id
        : `${config.folder}/${input.imageId}`,
    url,
  };
}

async function deleteListingObjectFromCloudinary(input: DeleteListingObjectInput) {
  const config = getCloudinaryStorageConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${config.folder.replace(/\/$/, '')}/${input.imageId}`;
  const destroyParams = {
    public_id: publicId,
    timestamp,
  };
  const formData = new FormData();

  formData.append('api_key', config.apiKey);
  formData.append('public_id', destroyParams.public_id);
  formData.append('timestamp', String(destroyParams.timestamp));
  formData.append(
    'signature',
    createCloudinarySignature(destroyParams, config.apiSecret),
  );

  const response = await fetchWithTimeout(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      config.cloudName,
    )}/image/destroy`,
    {
      method: 'POST',
      body: formData,
    },
    getObjectStorageTimeoutMs(),
  );

  if (!response.ok) {
    throw new Error(`Cloudinary delete failed with status ${response.status}.`);
  }

  const result = (await response.json()) as { result?: unknown };

  return result.result === 'ok' || result.result === 'not found';
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

  if (getObjectStorageMode() === 'cloudinary') {
    return storeListingObjectInCloudinary(input);
  }

  return storeListingObjectInS3(input);
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

  if (getObjectStorageMode() === 'cloudinary') {
    return deleteListingObjectFromCloudinary(input);
  }

  return false;
}
