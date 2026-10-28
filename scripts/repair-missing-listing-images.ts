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
};

type ImageRecord = {
  id: string;
  listingId: string;
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

const apply = process.argv.includes('--apply');
const batchSizeArgument = process.argv.find((value) =>
  value.startsWith('--batch-size='),
);
const requestedBatchSize = Number(batchSizeArgument?.split('=')[1] ?? 100);
const batchSize = Number.isInteger(requestedBatchSize)
  ? Math.min(Math.max(requestedBatchSize, 1), 500)
  : 100;

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
    secretAccessKey: requireConfigValue(
      'SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY',
    ),
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
    const key = getXmlTagValue(match[1] ?? '', 'Key');

    if (key) {
      objects.push({ key });
    }
  }

  return {
    objects,
    isTruncated: getXmlTagValue(xml, 'IsTruncated') === 'true',
    nextContinuationToken:
      getXmlTagValue(xml, 'NextContinuationToken') ?? undefined,
  };
}

async function listR2ListingObjectKeys(config: ObjectStorageConfig) {
  const keys = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const response = await fetch(createListObjectsUrl(config, continuationToken));

    if (!response.ok) {
      throw new Error(`R2 list request failed with status ${response.status}.`);
    }

    const parsed = parseListObjectsResponse(await response.text());

    for (const object of parsed.objects) {
      keys.add(object.key);
    }

    continuationToken = parsed.isTruncated
      ? parsed.nextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

function getObjectKeyFromUrl(config: ObjectStorageConfig, urlValue: string) {
  let url: URL;

  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  const publicUrl = new URL(config.publicUrl);
  const publicPathPrefix = publicUrl.pathname.replace(/\/$/, '');

  if (url.origin !== publicUrl.origin) {
    return null;
  }

  const pathname = decodeURIComponent(url.pathname);

  if (publicPathPrefix && !pathname.startsWith(`${publicPathPrefix}/`)) {
    return null;
  }

  return pathname.slice(publicPathPrefix.length + 1).replace(/^\/+/, '');
}

function getExistingUrl(input: {
  image: ImageRecord;
  existingKeys: Set<string>;
  config: ObjectStorageConfig;
  preference: Array<keyof Pick<ImageRecord, 'originalUrl' | 'displayUrl' | 'thumbnailUrl'>>;
}) {
  for (const field of input.preference) {
    const url = input.image[field];
    const key = getObjectKeyFromUrl(input.config, url);

    if (key && input.existingKeys.has(key)) {
      return url;
    }
  }

  return null;
}

function analyzeImage(
  image: ImageRecord,
  config: ObjectStorageConfig,
  existingKeys: Set<string>,
) {
  const fields = [
    'originalUrl',
    'displayUrl',
    'thumbnailUrl',
  ] as const satisfies ReadonlyArray<
    keyof Pick<ImageRecord, 'originalUrl' | 'displayUrl' | 'thumbnailUrl'>
  >;
  const missingFields: string[] = [];
  const existingFields: string[] = [];

  for (const field of fields) {
    const key = getObjectKeyFromUrl(config, image[field]);

    if (!key || !existingKeys.has(key)) {
      missingFields.push(field);
    } else {
      existingFields.push(field);
    }
  }

  if (missingFields.length === 0) {
    return null;
  }

  if (existingFields.length === 0) {
    return {
      action: 'delete_record' as const,
      missingFields,
      data: null,
    };
  }

  const replacementUrl =
    getExistingUrl({
      image,
      existingKeys,
      config,
      preference: ['displayUrl', 'thumbnailUrl', 'originalUrl'],
    }) ?? image.displayUrl;

  return {
    action: 'repair_urls' as const,
    missingFields,
    data: {
      originalUrl: missingFields.includes('originalUrl')
        ? replacementUrl
        : image.originalUrl,
      displayUrl: missingFields.includes('displayUrl')
        ? replacementUrl
        : image.displayUrl,
      thumbnailUrl: missingFields.includes('thumbnailUrl')
        ? replacementUrl
        : image.thumbnailUrl,
    },
  };
}

async function main() {
  const config = getObjectStorageConfig();
  // Storage listing and DB pagination are not an atomic snapshot. Do not
  // classify an image committed during this scan as missing from an older list.
  const snapshotAt = new Date();
  const existingKeys = await listR2ListingObjectKeys(config);
  const totals = {
    scanned: 0,
    healthy: 0,
    repairable: 0,
    deleted: 0,
    failed: 0,
  };
  let cursor: string | undefined;

  console.log(
    `Listing image repair running in ${apply ? 'apply' : 'dry-run'} mode.`,
  );
  console.log(`R2 listing objects discovered: ${existingKeys.size}`);

  for (;;) {
    const records = await prisma.listingImage.findMany({
      where: { createdAt: { lte: snapshotAt } },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        listingId: true,
        originalUrl: true,
        displayUrl: true,
        thumbnailUrl: true,
      },
    });

    if (!records.length) {
      break;
    }

    for (const image of records) {
      totals.scanned += 1;
      const plan = analyzeImage(image, config, existingKeys);

      if (!plan) {
        totals.healthy += 1;
        continue;
      }

      try {
        if (plan.action === 'delete_record') {
          totals.deleted += 1;

          if (apply) {
            await prisma.listingImage.delete({ where: {
              id: image.id, originalUrl: image.originalUrl,
              displayUrl: image.displayUrl, thumbnailUrl: image.thumbnailUrl,
            } });
          }
        } else {
          totals.repairable += 1;

          if (apply) {
            await prisma.listingImage.update({
              where: { id: image.id, originalUrl: image.originalUrl,
                displayUrl: image.displayUrl, thumbnailUrl: image.thumbnailUrl },
              data: plan.data,
            });
          }
        }

        console.log(
          JSON.stringify({
            id: image.id,
            listingId: image.listingId,
            mode: apply ? 'apply' : 'dry-run',
            action: plan.action,
            missingFields: plan.missingFields,
          }),
        );
      } catch (error) {
        totals.failed += 1;
        console.error(
          JSON.stringify({
            id: image.id,
            listingId: image.listingId,
            action: plan.action,
            status: 'failed',
            reason: error instanceof Error ? error.message : 'unknown_error',
          }),
        );
      }
    }

    cursor = records.at(-1)?.id;
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...totals }));
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown repair failure.';
    console.error(`Listing image repair failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
