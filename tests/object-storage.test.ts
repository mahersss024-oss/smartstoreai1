import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteListingObject,
  getMissingObjectStorageConfig,
  storeListingObject,
} from '@/agent/marketplace/object-storage';

const objectStorageEnvKeys = [
  'SMARTSTORE_IMAGE_STORAGE',
  'SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS',
  'SMARTSTORE_OBJECT_STORAGE_ENDPOINT',
  'SMARTSTORE_OBJECT_STORAGE_BUCKET',
  'SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID',
  'SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'SMARTSTORE_OBJECT_STORAGE_REGION',
  'SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL',
] as const;

function withEnv(values: Record<string, string | undefined>) {
  const previous = new Map<string, string | undefined>();

  for (const key of objectStorageEnvKeys) {
    previous.set(key, process.env[key]);

    if (values[key] === undefined) {
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
