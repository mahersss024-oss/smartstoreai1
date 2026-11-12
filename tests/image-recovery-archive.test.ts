import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { deleteListingObject } from '@/agent/marketplace/object-storage';
import { getImageRecoveryConfig, imageRecoveryKey } from '@/agent/marketplace/image-recovery';

const sourceBucket = 'listing-images';
const recoveryBucket = 'private-recovery';
const keys = ['listings/2026/11/photo-display.webp', 'listings/2026/11/photo-thumbnail.webp'];
const sha = (key: string) => createHash('sha256').update(`${sourceBucket}/${key}`).digest('hex');
function environment(t: TestContext, extra: Record<string, string> = {}) {
  const values = {
    SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: sourceBucket, SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret', SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.test',
    SMARTSTORE_IMAGE_RECOVERY_BUCKET: recoveryBucket, SMARTSTORE_IMAGE_INTAKE_BUCKET: 'private-intake',
    SMARTSTORE_EVIDENCE_STORAGE_BUCKET: 'private-evidence', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ZONE_ID: '', ...extra,
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function removal(extra: Record<string, unknown> = {}) {
  return deleteListingObject({ imageId: 'photo', preserveForRecovery: true,
    urls: keys.map(key => `https://images.example.test/${key}`), ...extra });
}
function mockStorage(t: TestContext, options: {
  copyError?: boolean; corrupt?: boolean; absentSource?: boolean; priorArchive?: boolean; denied?: boolean;
} = {}) {
  const calls: Array<{ method: string; key: string; headers: Headers }> = [];
  const saved = new Set(options.priorArchive ? keys : []);
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const headers = new Headers(init?.headers);
    const inArchive = url.pathname.startsWith(`/${recoveryBucket}/`);
    const key = inArchive ? keys.find(value => url.pathname.endsWith('/' + value))! : url.pathname.slice(sourceBucket.length + 2);
    calls.push({ method, key, headers });
    assert.equal(url.hostname, 'account.r2.cloudflarestorage.com');
    assert.equal(init?.redirect, method === 'DELETE' ? undefined : 'error');
    if (method === 'HEAD' && !inArchive) return new Response(null, {
      status: options.absentSource ? 404 : 200,
      headers: { 'Content-Length': '100', 'Content-Type': 'image/webp', ETag: '"source"' },
    });
    if (method === 'HEAD') return new Response(null, {
      status: saved.has(key) ? 200 : 404,
      headers: { 'Content-Length': options.corrupt ? '99' : '100', 'x-amz-meta-source-hash': sha(key), 'x-amz-meta-source-size': '100' },
    });
    if (method === 'PUT') {
      assert.equal(inArchive, true); assert.equal(headers.get('cache-control'), 'private, no-store');
      assert.equal(headers.get('x-amz-copy-source'), `/${sourceBucket}/${key}`);
      assert.equal(headers.get('x-amz-copy-source-if-match'), '"source"');
      assert.equal(headers.get('x-amz-meta-source-hash'), sha(key));
      if (options.denied) return new Response(null, { status: 403 });
      saved.add(key);
      return new Response(options.copyError ? '<Error><Code>InternalError</Code></Error>' :
        '<CopyObjectResult><ETag>"copy"</ETag></CopyObjectResult>', { status: 200 });
    }
    assert.equal(method, 'DELETE');
    if (!options.absentSource) assert.equal(saved.size, keys.length, 'every variant must be archived before any deletion');
    return new Response(null, { status: options.absentSource ? 404 : 204 });
  });
  return calls;
}

test('committed photo deletion copies and verifies both delivery variants privately before public deletion', async t => {
  environment(t); const calls = mockStorage(t);
  assert.equal(await removal(), true);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 2);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 2);
  const firstDelete = calls.findIndex(call => call.method === 'DELETE');
  assert.ok(calls.slice(0, firstDelete).filter(call => call.method === 'HEAD').length >= 4);
});

for (const [label, options] of [
  ['embedded HTTP200 copy error', { copyError: true }],
  ['mismatched archived length', { corrupt: true }],
  ['archive permission failure', { denied: true }],
  ['missing source and missing archive', { absentSource: true }],
  ['missing source and truncated previous archive', { absentSource: true, priorArchive: true, corrupt: true }],
] as const) test(`recovery fails closed on ${label} without deleting any public object`, async t => {
  environment(t); const calls = mockStorage(t, options);
  await assert.rejects(removal());
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
});

test('retry after a lost delete acknowledgement accepts the existing verified private archive', async t => {
  environment(t); const calls = mockStorage(t, { absentSource: true, priorArchive: true });
  assert.equal(await removal(), true);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 2);
});

test('abandoned uploads bypass retention and only delete their public objects', async t => {
  environment(t); const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET'); return new Response(null, { status: 204 });
  });
  assert.equal(await removal({ preserveForRecovery: false }), true);
  assert.deepEqual(calls, ['DELETE', 'DELETE']);
});

test('unconfigured recovery preserves the existing deletion contract without remote copy requests', async t => {
  environment(t, { SMARTSTORE_IMAGE_RECOVERY_BUCKET: '' }); const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET'); return new Response(null, { status: 204 });
  });
  assert.equal(await removal(), true); assert.deepEqual(calls, ['DELETE', 'DELETE']);
});

test('recovery rejects public, evidence, intake and path-traversal destinations', t => {
  environment(t);
  const source = { endpoint: 'https://account.r2.cloudflarestorage.com', bucket: sourceBucket,
    accessKeyId: 'test', secretAccessKey: 'test', region: 'auto', publicUrl: 'https://images.example.test' };
  for (const bucket of [sourceBucket, 'private-intake', 'private-evidence', '../bad']) {
    process.env.SMARTSTORE_IMAGE_RECOVERY_BUCKET = bucket;
    assert.throws(() => getImageRecoveryConfig(source), /private_image_recovery_bucket_required/);
  }
  for (const key of ['cases/id/hash', 'listings/../private.webp', 'listings//bad.webp', '/listings/pic.webp']) {
    assert.throws(() => imageRecoveryKey(sourceBucket, key), /invalid_image_recovery_source/);
  }
  assert.equal(imageRecoveryKey(sourceBucket, keys[0]), imageRecoveryKey(sourceBucket, keys[0]));
});
