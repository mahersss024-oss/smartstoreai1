import { createHash, createHmac } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';

type ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicUrl: string;
};

type ListedObject = {
  key: string;
  size?: number;
  lastModified?: string;
};

function requireConfigValue(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getObjectStorageConfig(): ObjectStorageConfig {
  return {
    endpoint: requireConfigValue('SMARTSTORE_OBJECT_STORAGE_ENDPOINT'),
    bucket: requireConfigValue('SMARTSTORE_OBJECT_STORAGE_BUCKET'),
    accessKeyId: requireConfigValue('SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: requireConfigValue('SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY'),
    region: process.env.SMARTSTORE_OBJECT_STORAGE_REGION?.trim() || 'auto',
    publicUrl: requireConfigValue('SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL'),
  };
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

function sha256Hex(value: string) {
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

function getSigningKey(config: ObjectStorageConfig, dateStamp: string) {
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');

  return hmac(serviceKey, 'aws4_request');
}

function createListObjectsUrl(
  config: ObjectStorageConfig,
  continuationToken?: string,
) {
  const endpoint = new URL(config.endpoint);
  const listUrl = new URL(
    `${endpoint.pathname.replace(/\/$/, '')}/${config.bucket}`,
    endpoint,
  );
  const amzDate = getAmzDate();
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;
  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', '300'],
    ['X-Amz-SignedHeaders', 'host'],
    ['list-type', '2'],
    ['prefix', 'listings/'],
  ];

  if (continuationToken) {
    queryParams.push(['continuation-token', continuationToken]);
  }

  const canonicalQuery = buildCanonicalQuery(queryParams);
  const canonicalUri = listUrl.pathname
    .split('/')
    .map((segment) => awsEncode(segment))
    .join('/');
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${listUrl.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(config, dateStamp), stringToSign);

  for (const [key, value] of queryParams) {
    listUrl.searchParams.set(key, value);
  }

  listUrl.searchParams.set('X-Amz-Signature', signature);

  return listUrl;
}

function decodeXmlValue(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getXmlTagValue(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));

  return match ? decodeXmlValue(match[1] ?? '') : null;
}

function parseListObjectsResponse(xml: string) {
  const objects: ListedObject[] = [];
  const contentsPattern = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;

  while ((match = contentsPattern.exec(xml))) {
    const content = match[1] ?? '';
    const key = getXmlTagValue(content, 'Key');

    if (!key) {
      continue;
    }

    const size = Number.parseInt(getXmlTagValue(content, 'Size') ?? '', 10);

    objects.push({
      key,
      size: Number.isFinite(size) ? size : undefined,
      lastModified: getXmlTagValue(content, 'LastModified') ?? undefined,
    });
  }

  return {
    objects,
    isTruncated: getXmlTagValue(xml, 'IsTruncated') === 'true',
    nextContinuationToken:
      getXmlTagValue(xml, 'NextContinuationToken') ?? undefined,
  };
}

async function listR2ListingObjects(config: ObjectStorageConfig) {
  const objects: ListedObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await fetch(createListObjectsUrl(config, continuationToken));

    if (!response.ok) {
      throw new Error(`R2 list request failed with status ${response.status}.`);
    }

    const parsed = parseListObjectsResponse(await response.text());
    objects.push(...parsed.objects);
    continuationToken = parsed.isTruncated
      ? parsed.nextContinuationToken
      : undefined;
  } while (continuationToken);

  return objects;
}

function getObjectKeyFromUrl(config: ObjectStorageConfig, urlValue: string) {
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
      const pathname = decodeURIComponent(url.pathname);

      if (!publicPathPrefix || pathname.startsWith(`${publicPathPrefix}/`)) {
        return pathname.slice(publicPathPrefix.length + 1).replace(/^\/+/, '');
      }
    }
  }

  return null;
}

async function getReferencedListingImageKeys(config: ObjectStorageConfig) {
  const images = await prisma.listingImage.findMany({
    select: {
      id: true,
      originalUrl: true,
      displayUrl: true,
      thumbnailUrl: true,
      listingId: true,
    },
  });
  const keys = new Set<string>();

  for (const image of images) {
    for (const url of [
      image.originalUrl,
      image.displayUrl,
      image.thumbnailUrl,
    ]) {
      const key = getObjectKeyFromUrl(config, url);

      if (key) {
        keys.add(key);
      }
    }
  }

  return {
    keys,
    imageRecordCount: images.length,
  };
}

async function main() {
  const config = getObjectStorageConfig();
  const [r2Objects, referenced] = await Promise.all([
    listR2ListingObjects(config),
    getReferencedListingImageKeys(config),
  ]);
  const orphanedObjects = r2Objects.filter(
    (object) => !referenced.keys.has(object.key),
  );
  const totalOrphanedBytes = orphanedObjects.reduce(
    (total, object) => total + (object.size ?? 0),
    0,
  );

  console.log('R2 listing images dry-run only. No objects were deleted.');
  console.log(`Database image records: ${referenced.imageRecordCount}`);
  console.log(`Referenced object keys: ${referenced.keys.size}`);
  console.log(`R2 objects under listings/: ${r2Objects.length}`);
  console.log(`Potential orphaned objects: ${orphanedObjects.length}`);
  console.log(`Potential orphaned bytes: ${totalOrphanedBytes}`);

  for (const object of orphanedObjects.slice(0, 100)) {
    console.log(
      JSON.stringify({
        key: object.key,
        size: object.size,
        lastModified: object.lastModified,
        reason: 'not referenced by ListingImage original/display/thumbnail URLs',
      }),
    );
  }

  if (orphanedObjects.length > 100) {
    console.log(`Additional orphaned objects omitted: ${orphanedObjects.length - 100}`);
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown dry-run failure.';
    console.error(`R2 orphan dry-run failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
