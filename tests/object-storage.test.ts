import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteListingObject,
  getMissingObjectStorageConfig,
  storeListingObject,
} from '@/agent/marketplace/object-storage';
import { getRuntimeMetricsSnapshot, resetRuntimeMetrics } from '@/lib/observability/runtime-metrics';

const objectStorageEnvKeys = [
  'SMARTSTORE_MARKETPLACE_STORE',
  'SMARTSTORE_IMAGE_STORAGE',
  'SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS',
  'SMARTSTORE_OBJECT_STORAGE_ENDPOINT',
  'SMARTSTORE_OBJECT_STORAGE_BUCKET',
  'SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID',
  'SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'SMARTSTORE_OBJECT_STORAGE_REGION',
  'SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',
  'CLOUDFLARE_CACHE_PURGE_TIMEOUT_MS',
] as const;

function withEnv(values: Record<string, string | undefined>) {
  const previous = new Map<string, string | undefined>();

  for (const key of objectStorageEnvKeys) {
    previous.set(key, process.env[key]);

    if (key === 'SMARTSTORE_MARKETPLACE_STORE') {
      process.env[key] = 'file';
    } else if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

test('does not enable legacy Cloudinary image storage', async () => {
  const restore = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 'cloudinary',
  });
  const originalFetch = globalThis.fetch;
  let calledFetch = false;

  globalThis.fetch = async () => {
    calledFetch = true;

    return new Response(null, { status: 200 });
  };

  try {
    assert.deepEqual(getMissingObjectStorageConfig(), []);
    assert.equal(
      await storeListingObject({
        data: new Uint8Array([1, 2, 3]),
        mediaType: 'image/png',
        imageId: 'image-1',
        fileName: 'chair.png',
      }),
      null,
    );
    assert.equal(calledFetch, false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('durable cleanup retains an incomplete result until Cloudflare cache deletion succeeds', async () => {
  const restore = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
    SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.test',
    CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ZONE_ID: 'test-zone',
  });
  const originalFetch = globalThis.fetch;
  let succeeds = false;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    assert.equal(new URL(String(input)).hostname, 'api.cloudflare.com');
    return Response.json({ success: succeeds }, { status: succeeds ? 200 : 400 });
  };
  const input = { imageId: 'durable-cleanup', urls: ['https://images.example.test/listings/2026/10/durable-cleanup.jpg'], requireCachePurge: true };
  try {
    assert.equal(await deleteListingObject(input), false);
    succeeds = true;
    assert.equal(await deleteListingObject(input), true);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('uploads listing images to S3-compatible storage with SigV4 query signing', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT:
      'https://account-id.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
    SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.com',
    CLOUDFLARE_API_TOKEN: undefined,
    CLOUDFLARE_ZONE_ID: undefined,
  });
  const originalFetch = globalThis.fetch;
  const uploaded: {
    url: URL | null;
    headers: Headers;
  } = {
    url: null,
    headers: new Headers(),
  };

  globalThis.fetch = async (input, init) => {
    uploaded.url = new URL(String(input));
    uploaded.headers = new Headers(init?.headers);

    return new Response(null, { status: 200 });
  };

  try {
    const now = new Date();
    const expectedPrefix = `listings/${now.getUTCFullYear()}/${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}/image-1.jpg`;
    const result = await storeListingObject({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/jpeg',
      imageId: 'image-1',
      fileName: 'car.jpg',
    });

    assert.ok(uploaded.url);
    assert.equal(uploaded.url.host, 'account-id.r2.cloudflarestorage.com');
    assert.equal(uploaded.url.pathname, `/listing-images/${expectedPrefix}`);
    assert.equal(
      uploaded.url.searchParams.get('X-Amz-Algorithm'),
      'AWS4-HMAC-SHA256',
    );
    assert.equal(
      uploaded.url.searchParams.get('X-Amz-SignedHeaders'),
      'cache-control;content-type;host',
    );
    assert.equal(uploaded.headers.has('Authorization'), false);
    assert.equal(uploaded.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(
      uploaded.headers.get('Cache-Control'),
      'public, max-age=31536000, immutable',
    );
    assert.equal(result?.key, expectedPrefix);
    assert.equal(result?.url, `https://images.example.com/${expectedPrefix}`);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('deletes stored listing image variants from S3-compatible storage', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT:
      'https://account-id.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
    SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.com',
  });
  const originalFetch = globalThis.fetch;
  const deletedPaths: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));

    if (init?.method === 'DELETE') {
      deletedPaths.push(url.pathname);
    }

    return new Response(null, { status: 204 });
  };

  try {
    const deleted = await deleteListingObject({
      imageId: 'image-1',
      urls: [
        'https://images.example.com/listings/2026/09/image-1.jpg',
        'https://images.example.com/listings/2026/09/image-1-display.jpg',
        'https://images.example.com/listings/2026/09/image-1-thumbnail.jpg',
      ],
    });

    assert.equal(deleted, true);
    assert.deepEqual(deletedPaths.sort(), [
      '/listing-images/listings/2026/09/image-1-display.jpg',
      '/listing-images/listings/2026/09/image-1-thumbnail.jpg',
      '/listing-images/listings/2026/09/image-1.jpg',
    ].sort());
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('purges Cloudflare cache for deleted listing image variants when configured', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT:
      'https://account-id.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
    SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.com',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLOUDFLARE_ZONE_ID: 'cf-zone',
  });
  const originalFetch = globalThis.fetch;
  const purges: Array<{
    url: string;
    authorization: string | null;
    files: string[];
  }> = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));

    if (url.host === 'api.cloudflare.com') {
      purges.push({
        url: url.toString(),
        authorization: new Headers(init?.headers).get('Authorization'),
        files: ((JSON.parse(String(init?.body)) as { files: string[] }).files),
      });

      return Response.json({ success: true });
    }

    return new Response(null, { status: 204 });
  };

  try {
    const urls = [
      'https://images.example.com/listings/2026/09/image-1.jpg',
      'https://images.example.com/listings/2026/09/image-1-display.jpg',
      'https://images.example.com/listings/2026/09/image-1-thumbnail.jpg',
    ];

    assert.equal(
      await deleteListingObject({
        imageId: 'image-1',
        urls,
      }),
      true,
    );
    assert.equal(
      purges[0]?.url,
      'https://api.cloudflare.com/client/v4/zones/cf-zone/purge_cache',
    );
    assert.equal(purges[0]?.authorization, 'Bearer cf-token');
    assert.deepEqual(purges[0]?.files.sort(), urls.sort());
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('keeps image deletion successful when Cloudflare cache purge fails', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT:
      'https://account-id.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
    SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.com',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLOUDFLARE_ZONE_ID: 'cf-zone',
  });
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: unknown) => warnings.push(String(message));
  let failure: 'json' | 'html' | 'network' = 'json';

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.host === 'api.cloudflare.com') {
      if (failure === 'network') throw new TypeError('network error containing cf-token');
      if (failure === 'html') return new Response('proxy error cf-token', { status: 502 });
      return Response.json({ success: false, errors: [
        { code: 10000, message: 'Authentication error cf-token test-secret-key' },
        { code: 'cf-token' },
      ] }, { status: 403 });
    }

    return new Response(null, { status: 204 });
  };

  try {
    for (const scenario of ['json', 'html', 'network'] as const) {
      failure = scenario;
      assert.equal(
        await deleteListingObject({
          imageId: 'image-1',
          urls: [
            'https://images.example.com/listings/2026/09/image-1.jpg',
          ],
        }),
        true,
      );
    }
    assert.deepEqual(warnings, [
      '[cloudflare_cache_purge] failure=provider_rejected status=403 codes=10000',
      '[cloudflare_cache_purge] failure=provider_rejected status=502 codes=none',
      '[cloudflare_cache_purge] failure=TypeError',
    ]);
    assert.doesNotMatch(warnings.join(' '), /cf-token|test-secret-key/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    restoreEnv();
  }
});

test('times out stalled S3-compatible uploads instead of waiting indefinitely', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS: '1',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT:
      'https://account-id.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
    SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.com',
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });

    throw new Error('unreachable');
  };

  try {
    await assert.rejects(
      () =>
        storeListingObject({
          data: new Uint8Array([1, 2, 3]),
          mediaType: 'image/png',
          imageId: 'image-timeout',
          fileName: 'chair.png',
        }),
      /AbortError|TimeoutError|aborted|timed out/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

const retryTestEnvironment = {
  SMARTSTORE_IMAGE_STORAGE: 's3',
  SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
  SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
  SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
  SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
  SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
  SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.com',
  CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ZONE_ID: 'cf-zone',
};

test('transient R2 deletion and Cloudflare purge failures recover before completion', async t => {
  const restore = withEnv(retryTestEnvironment); t.after(restore);
  resetRuntimeMetrics();
  let deletes = 0;
  let purges = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (new URL(String(input)).host === 'api.cloudflare.com') {
      if (++purges === 1) return Response.json({ success: false }, { status: 503 });
      return Response.json({ success: true });
    }
    return new Response(null, { status: ++deletes === 1 ? 503 : 204 });
  });
  assert.equal(await deleteListingObject({ imageId: 'retry-delete', urls: ['https://images.example.com/listings/retry-delete.jpg'] }), true);
  assert.equal(deletes, 2);
  assert.equal(purges, 2);
  assert.equal(getRuntimeMetricsSnapshot().counters['image.cache_purge.completed'], 1);
  assert.equal(getRuntimeMetricsSnapshot().counters['image.storage.failed{operation:delete}'], undefined);
});

test('successful sibling deletion is purged even when another R2 object cannot be removed', async t => {
  const restore = withEnv(retryTestEnvironment); t.after(restore);
  let failedDeletes = 0;
  let purgeFiles: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === 'api.cloudflare.com') {
      purgeFiles = JSON.parse(String(init?.body)).files;
      return Response.json({ success: true });
    }
    if (url.pathname.endsWith('denied.jpg')) { failedDeletes++; return new Response(null, { status: 403 }); }
    return new Response(null, { status: 204 });
  });
  const urls = ['https://images.example.com/listings/removed.jpg', 'https://images.example.com/listings/denied.jpg'];
  await assert.rejects(deleteListingObject({ imageId: 'partial-delete', urls }), /status 403/);
  assert.equal(failedDeletes, 1, 'permanent authorization failure is not retried');
  assert.deepEqual(purgeFiles, urls);
});

test('Cloudflare HTTP success with a rejected operation is observable and never counted as completed', async t => {
  const restore = withEnv(retryTestEnvironment); t.after(restore);
  resetRuntimeMetrics();
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: unknown) => warnings.push(String(message)));
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
    new URL(String(input)).host === 'api.cloudflare.com'
      ? Response.json({ success: false, errors: [{ code: 10000, message: 'cf-token secret' }] })
      : new Response(null, { status: 204 }));
  assert.equal(await deleteListingObject({ imageId: 'false-success', urls: ['https://images.example.com/listings/false-success.jpg'] }), true);
  assert.equal(getRuntimeMetricsSnapshot().counters['image.cache_purge.completed'], undefined);
  assert.equal(getRuntimeMetricsSnapshot().counters['image.cache_purge.incomplete{reason:provider_failure}'], 1);
  assert.match(warnings.join(' '), /status=200 codes=10000/);
  assert.doesNotMatch(warnings.join(' '), /cf-token|secret/);
});

test('missing Cloudflare purge configuration is recorded rather than silently skipped', async t => {
  const restore = withEnv({ ...retryTestEnvironment, CLOUDFLARE_API_TOKEN: undefined }); t.after(restore);
  resetRuntimeMetrics();
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: unknown) => warnings.push(String(message)));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  await deleteListingObject({ imageId: 'missing-purge-config', urls: ['https://images.example.com/listings/missing.jpg'] });
  assert.equal(getRuntimeMetricsSnapshot().counters['image.cache_purge.incomplete{reason:missing_config}'], 1);
  assert.deepEqual(warnings, ['[cloudflare_cache_purge] outcome=incomplete reason=missing_config']);
});

test('Cloudflare response body remains abortable after headers arrive', async t => {
  const restore = withEnv({ ...retryTestEnvironment, CLOUDFLARE_CACHE_PURGE_TIMEOUT_MS: '1' }); t.after(restore);
  resetRuntimeMetrics();
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: unknown) => warnings.push(String(message)));
  let purges = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).host !== 'api.cloudflare.com') return new Response(null, { status: 204 });
    purges++;
    const body = new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });
  const startedAt = Date.now();
  assert.equal(await deleteListingObject({ imageId: 'body-stalled', urls: ['https://images.example.com/listings/stalled.jpg'] }), true);
  assert.equal(purges, 1, 'the exhausted total budget cannot start another request');
  assert.ok(Date.now() - startedAt < 2500);
  assert.equal(getRuntimeMetricsSnapshot().counters['image.cache_purge.incomplete{reason:provider_failure}'], 1);
  assert.deepEqual(warnings, ['[cloudflare_cache_purge] failure=TimeoutError']);
});
