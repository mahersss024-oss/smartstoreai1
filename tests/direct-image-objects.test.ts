import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDirectImageTransfer,
  discardDirectImageObjects,
  getDirectImagePublicUrls,
  getDirectImageUploadCapability,
  getDirectImageUploadConfiguration,
  promoteProcessedImages,
  readProcessedImage,
  type DirectImageObjectJob,
} from '@/agent/marketplace/direct-image-objects';

const values = {
  SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'true',
  SMARTSTORE_MARKETPLACE_STORE: 'database',
  SMARTSTORE_IMAGE_STORAGE: 's3',
  SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  SMARTSTORE_OBJECT_STORAGE_BUCKET: 'public-images',
  SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'isolated-key',
  SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'isolated-secret',
  SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.test',
  SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
  SMARTSTORE_IMAGE_INTAKE_BUCKET: 'private-intake',
  SMARTSTORE_EVIDENCE_STORAGE_BUCKET: 'private-evidence',
  SMARTSTORE_IMAGE_WORKER_SECRET: 'isolated-image-worker-secret-32-characters',
};
function environment(overrides: Partial<Record<keyof typeof values, string>> = {}) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values, overrides);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
}
function fixture(): DirectImageObjectJob {
  return {
    id: 'upload-one', listingId: 'listing-one', sellerId: 'seller-one',
    sourceKey: 'intake/v1/upload-one.jpg',
    originalKey: 'staged/v1/upload-one/lease-one/original.jpg',
    displayKey: 'staged/v1/upload-one/lease-one/display.webp',
    thumbnailKey: 'staged/v1/upload-one/lease-one/thumbnail.webp',
    sha256: 'a'.repeat(64), sizeBytes: 3,
    createdAt: new Date('2026-10-27T00:00:00Z'), expiresAt: new Date(Date.now() + 3_600_000),
  };
}

test('direct images remain disabled by default and incomplete opt-in is not advertised', () => {
  const restore = environment({ SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'false' });
  try {
    assert.equal(getDirectImageUploadConfiguration(), null);
    assert.deepEqual(getDirectImageUploadCapability(), { protocol: 'r2-direct-v1', enabled: false });
    process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'true';
    process.env.SMARTSTORE_IMAGE_WORKER_SECRET = '';
    assert.throws(() => getDirectImageUploadConfiguration(), /configuration_invalid/);
    assert.equal(getDirectImageUploadCapability().enabled, false);
  } finally { restore(); }
});

test('raw intake must be separate from public images and protected evidence', () => {
  const restore = environment();
  try {
    for (const bucket of ['public-images', 'private-evidence']) {
      process.env.SMARTSTORE_IMAGE_INTAKE_BUCKET = bucket;
      assert.throws(() => getDirectImageUploadConfiguration(), /configuration_invalid/);
    }
    process.env.SMARTSTORE_IMAGE_INTAKE_BUCKET = 'private-intake';
    process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
    assert.throws(() => getDirectImageUploadConfiguration(), /configuration_invalid/);
  } finally { restore(); }
});

test('signed direct transfers bind a private create-once JPEG and cannot outlive the job', () => {
  const restore = environment();
  try {
    const transfer = createDirectImageTransfer({ ...fixture(), expiresAt: new Date(Date.now() + 60_000) });
    const url = new URL(transfer.url);
    assert.equal(url.pathname, '/private-intake/intake/v1/upload-one.jpg');
    assert.equal(transfer.method, 'PUT');
    assert.deepEqual(transfer.headers, {
      'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'If-None-Match': '*',
      'Content-Length': '3',
    });
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'cache-control;content-length;content-type;host;if-none-match');
    const larger = createDirectImageTransfer({ ...fixture(), sizeBytes: 4, expiresAt: new Date(Date.now() + 60_000) });
    assert.notEqual(new URL(larger.url).searchParams.get('X-Amz-Signature'), url.searchParams.get('X-Amz-Signature'));
    assert.ok(Number(url.searchParams.get('X-Amz-Expires')) <= 60);
    assert.equal('Authorization' in transfer.headers, false);
    assert.throws(() => createDirectImageTransfer({ ...fixture(), expiresAt: new Date(0) }), /expired/);
  } finally { restore(); }
});

test('delivery URLs retain the existing listings path and creation month across delayed processing', () => {
  const restore = environment();
  try {
    assert.deepEqual(getDirectImagePublicUrls(fixture()), {
      originalUrl: 'https://images.example.test/listings/2026/10/upload-one.jpg',
      displayUrl: 'https://images.example.test/listings/2026/10/upload-one-display.webp',
      thumbnailUrl: 'https://images.example.test/listings/2026/10/upload-one-thumbnail.webp',
    });
  } finally { restore(); }
});

test('staged reads reject keys from another job and mismatched image types', async () => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'text/html' } }); };
  try {
    await assert.rejects(readProcessedImage({ ...fixture(), originalKey: 'staged/v1/someone-else/lease/original.jpg' }, 'original'), /object_key/);
    assert.equal(requests, 0);
    await assert.rejects(readProcessedImage(fixture(), 'original'), /image_type_mismatch/);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('staged reads enforce the byte limit on streamed bodies, not only metadata', async () => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array(12 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg' } });
  try { await assert.rejects(readProcessedImage(fixture(), 'original'), /image_too_large/); }
  finally { globalThis.fetch = originalFetch; restore(); }
});

test('promotion copies verified private objects server-side without uploading bytes or replacing immutable files', async () => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  const copies: Array<{ url: URL; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': '3', 'Content-Type': url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/webp', ETag: '"verified-etag"' } });
    assert.equal(init?.method, 'PUT');
    assert.equal(init.body, undefined);
    copies.push({ url, headers: new Headers(init.headers) });
    return new Response('<CopyObjectResult><ETag>"verified-etag"</ETag></CopyObjectResult>');
  };
  try {
    const result = await promoteProcessedImages(fixture());
    assert.equal(copies.length, 3);
    assert.equal(result.originalUrl, getDirectImagePublicUrls(fixture()).originalUrl);
    for (const copy of copies) {
      assert.ok(copy.url.pathname.startsWith('/public-images/listings/2026/10/'));
      assert.ok(copy.headers.get('x-amz-copy-source')?.startsWith('/private-intake/staged/v1/upload-one/lease-one/'));
      assert.equal(copy.headers.get('x-amz-copy-source-if-match'), '"verified-etag"');
      assert.equal(copy.headers.get('cf-copy-destination-if-none-match'), '*');
      assert.equal(copy.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    }
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('a successful HTTP status containing an S3 copy error is not accepted as a ready image', async () => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => init?.method === 'HEAD'
    ? new Response(null, { headers: { 'Content-Length': '3', 'Content-Type': 'image/jpeg', ETag: '"etag"' } })
    : new Response('<Error><Code>InternalError</Code></Error>', { status: 200 });
  try { await assert.rejects(promoteProcessedImages(fixture()), /status 503/); }
  finally { globalThis.fetch = originalFetch; restore(); }
});

test('ambiguous copy retries accept only an existing destination matching the staged content', async () => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'PUT') return new Response(null, { status: 412 });
    const isPrivate = new URL(String(input)).pathname.startsWith('/private-intake/');
    return new Response(null, { headers: { 'Content-Length': '3', 'Content-Type': String(input).includes('original.jpg') ? 'image/jpeg' : 'image/webp', ETag: isPrivate ? '"expected"' : '"different"' } });
  };
  try { await assert.rejects(promoteProcessedImages(fixture()), /destination_conflict/); }
  finally { globalThis.fetch = originalFetch; restore(); }
});

test('default cleanup only deletes known private source and lease objects', async () => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  const deleted: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, 'DELETE');
    deleted.push(new URL(String(input)).pathname);
    return new Response(null, { status: 204 });
  };
  try {
    await discardDirectImageObjects(fixture());
    assert.equal(deleted.length, 4);
    assert.ok(deleted.every(key => key.startsWith('/private-intake/')));
    assert.ok(!deleted.some(key => key.includes('/listings/') || key.includes('evidence')));
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('turning the rollout off stops new transfers while private cleanup remains possible', async () => {
  const restore = environment({ SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'false' });
  const originalFetch = globalThis.fetch;
  let deleted = 0;
  globalThis.fetch = async () => { deleted++; return new Response(null, { status: 204 }); };
  try {
    assert.equal(getDirectImageUploadCapability().enabled, false);
    assert.throws(() => createDirectImageTransfer(fixture()), /disabled/);
    assert.equal(await discardDirectImageObjects(fixture()), true);
    assert.equal(deleted, 4);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('a slow first storage operation cannot start later copies outside the transaction I/O budget', async t => {
  const restore = environment();
  const originalFetch = globalThis.fetch;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    now += 91_000;
    return new Response(null, { headers: { 'Content-Length': '3', 'Content-Type': 'image/jpeg', ETag: '"expected"' } });
  };
  try {
    await assert.rejects(promoteProcessedImages(fixture()), { name: 'TimeoutError' });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; restore(); }
});
