import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMissingObjectStorageConfig,
  storeListingObject,
} from '@/agent/marketplace/object-storage';

const cloudinaryEnvKeys = [
  'SMARTSTORE_IMAGE_STORAGE',
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
