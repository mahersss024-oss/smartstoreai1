import assert from 'node:assert/strict';
import test from 'node:test';
import { readDirectImageJson, imageUploadWorkerAuthorized } from '@/lib/api/direct-image-upload-route';

test('worker credentials cannot be replaced by a customer session or a prefix of the secret', () => {
  const previous = process.env.SMARTSTORE_IMAGE_WORKER_SECRET;
  process.env.SMARTSTORE_IMAGE_WORKER_SECRET = 'isolated-worker-secret-which-is-long-enough';
  try {
    assert.equal(imageUploadWorkerAuthorized(new Request('https://example.test', { headers: { Cookie: 'smartstore_session=customer' } })), false);
    assert.equal(imageUploadWorkerAuthorized(new Request('https://example.test', { headers: { Authorization: 'Bearer isolated-worker-secret' } })), false);
    assert.equal(imageUploadWorkerAuthorized(new Request('https://example.test', { headers: { Authorization: `Bearer ${process.env.SMARTSTORE_IMAGE_WORKER_SECRET}` } })), true);
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_IMAGE_WORKER_SECRET;
    else process.env.SMARTSTORE_IMAGE_WORKER_SECRET = previous;
  }
});

test('worker payloads are limited by actual streamed bytes, including without content-length', async () => {
  const request = new Request('https://example.test', { method: 'POST', body: 'x'.repeat(4097) });
  await assert.rejects(readDirectImageJson(request), { code: 'request_too_large', status: 413 });
});

test('invalid and empty worker JSON never reaches job operations', async () => {
  await assert.rejects(readDirectImageJson(new Request('https://example.test', { method: 'POST', body: '{' })), { code: 'invalid_json' });
  await assert.rejects(readDirectImageJson(new Request('https://example.test', { method: 'POST' })), { code: 'invalid_json' });
});

test('a stalled worker request body expires instead of retaining a request indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = false;
  const stream = new ReadableStream({ cancel() { closed = true; } });
  const request = new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  const result = assert.rejects(readDirectImageJson(request), { code: 'request_timeout', status: 408 });
  t.mock.timers.tick(10_000);
  await result;
  assert.equal(closed, true);
});
