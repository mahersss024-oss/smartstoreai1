import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteListingObject,
  getMissingObjectStorageConfig,
  storeListingObject,
} from '@/agent/marketplace/object-storage';

const cloudinaryEnvKeys = [
  'SMARTSTORE_IMAGE_STORAGE',
  'SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS',
  'SMARTSTORE_OBJECT_STORAGE_ENDPOINT',
  'SMARTSTORE_OBJECT_STORAGE_BUCKET',
  'SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID',
  'SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'SMARTSTORE_OBJECT_STORAGE_REGION',
  'SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_FOLDER',
] as const;

function withEnv(values: Record<string, string | undefined>) {
  const previous = new Map<string, string | undefined>();

  for (const key of cloudinaryEnvKeys) {
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

test('reports missing Cloudinary configuration when Cloudinary storage is enabled', () => {
  const restore = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: undefined,
    CLOUDINARY_API_SECRET: undefined,
    CLOUDINARY_FOLDER: undefined,
  });

  try {
    assert.deepEqual(getMissingObjectStorageConfig(), [
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ]);
  } finally {
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
      'host',
    );
    assert.equal(uploaded.headers.has('Authorization'), false);
    assert.equal(uploaded.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(result?.key, expectedPrefix);
    assert.equal(result?.url, `https://images.example.com/${expectedPrefix}`);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('uploads listing images to Cloudinary with a signed server request', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: 'test-api-key',
    CLOUDINARY_API_SECRET: 'test-api-secret',
    CLOUDINARY_FOLDER: 'smartstore-test/listings',
  });
  const originalFetch = globalThis.fetch;
  const uploaded: {
    url: string;
    formData: FormData | null;
  } = {
    url: '',
    formData: null,
  };

  globalThis.fetch = async (input, init) => {
    uploaded.url = String(input);
    uploaded.formData = init?.body instanceof FormData ? init.body : null;

    return Response.json({
      public_id: 'smartstore-test/listings/image-1',
      secure_url:
        'https://res.cloudinary.com/demo-cloud/image/upload/v1/smartstore-test/listings/image-1.png',
    });
  };

  try {
    const result = await storeListingObject({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      imageId: 'image-1',
      fileName: 'chair.png',
    });

    assert.equal(
      uploaded.url,
      'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
    );
    const formData = uploaded.formData;

    assert.ok(formData);
    assert.equal(formData.get('api_key'), 'test-api-key');
    assert.equal(formData.get('folder'), 'smartstore-test/listings');
    assert.equal(formData.get('public_id'), 'image-1');
    assert.equal(typeof formData.get('signature'), 'string');
    assert.equal(result?.key, 'smartstore-test/listings/image-1');
    assert.equal(
      result?.url,
      'https://res.cloudinary.com/demo-cloud/image/upload/v1/smartstore-test/listings/image-1.png',
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('deletes Cloudinary listing images with a signed server request', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: 'test-api-key',
    CLOUDINARY_API_SECRET: 'test-api-secret',
    CLOUDINARY_FOLDER: 'smartstore-test/listings',
  });
  const originalFetch = globalThis.fetch;
  const deleted: {
    url: string;
    formData: FormData | null;
  } = {
    url: '',
    formData: null,
  };

  globalThis.fetch = async (input, init) => {
    deleted.url = String(input);
    deleted.formData = init?.body instanceof FormData ? init.body : null;

    return Response.json({ result: 'ok' });
  };

  try {
    const result = await deleteListingObject({ imageId: 'image-1' });

    assert.equal(
      deleted.url,
      'https://api.cloudinary.com/v1_1/demo-cloud/image/destroy',
    );
    const formData = deleted.formData;

    assert.ok(formData);
    assert.equal(formData.get('api_key'), 'test-api-key');
    assert.equal(formData.get('public_id'), 'smartstore-test/listings/image-1');
    assert.equal(typeof formData.get('signature'), 'string');
    assert.equal(result, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('times out stalled Cloudinary uploads instead of waiting indefinitely', async () => {
  const restoreEnv = withEnv({
    SMARTSTORE_IMAGE_STORAGE: 'cloudinary',
    SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS: '1',
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: 'test-api-key',
    CLOUDINARY_API_SECRET: 'test-api-secret',
    CLOUDINARY_FOLDER: 'smartstore-test/listings',
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
