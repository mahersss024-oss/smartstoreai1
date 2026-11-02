import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRequestContentLength,
  rejectOversizedRequest,
} from '@/lib/api/request-size';
import { POST as acceptCommissionAgreement } from '@/app/api/auth/commission-agreement/route';

test('parses valid request content length headers', () => {
  const request = new Request('http://localhost/api/test', {
    headers: { 'content-length': '42' },
  });

  assert.equal(getRequestContentLength(request), 42);
});

test('ignores missing or malformed content length headers', () => {
  assert.equal(
    getRequestContentLength(new Request('http://localhost/api/test')),
    null,
  );
  assert.equal(
    getRequestContentLength(
      new Request('http://localhost/api/test', {
        headers: { 'content-length': 'not-a-number' },
      }),
    ),
    null,
  );
  assert.equal(
    getRequestContentLength(
      new Request('http://localhost/api/test', {
        headers: { 'content-length': '1e6' },
      }),
    ),
    null,
  );
});

test('rejects requests whose declared body size exceeds the configured limit', async () => {
  const request = new Request('http://localhost/api/test', {
    headers: { 'content-length': '1025' },
  });
  const response = await rejectOversizedRequest(request, 1024);

  assert.equal(response?.status, 413);
});

function streamedRequest(body: ReadableStream<Uint8Array>, options: { headers?: HeadersInit; signal?: AbortSignal } = {}) {
  return new Request('http://localhost/api/test', {
    method: 'POST', body, duplex: 'half', ...options,
  } as RequestInit);
}

test('enforces actual bytes when Content-Length is missing, malformed, or understated', async () => {
  for (const length of [undefined, 'not-a-number', '1']) {
    const request = new Request('http://localhost/api/test', {
      method: 'POST', body: 'x'.repeat(1025),
      headers: length === undefined ? {} : { 'content-length': length },
    });
    assert.equal((await rejectOversizedRequest(request, 1024))?.status, 413);
  }
});

test('counts UTF-8 bytes and retains an exact-limit JSON body for its route parser', async () => {
  const value = { message: 'حمد 👋', accepted: true };
  const body = JSON.stringify(value);
  const bytes = new TextEncoder().encode(body);
  const request = streamedRequest(new ReadableStream({
    start(controller) {
      // Split inside multibyte characters as well as inside JSON tokens.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { headers: { 'content-type': 'application/json' } });
  assert.equal(await rejectOversizedRequest(request, bytes.byteLength), null);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual(await request.json(), value);
  const oversized = new Request('http://localhost/api/test', { method: 'POST', body });
  assert.equal((await rejectOversizedRequest(oversized, bytes.byteLength - 1))?.status, 413);
});

test('accepts multipart bytes without consuming the file needed by formData()', async () => {
  const data = new FormData();
  data.set('image', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 7, 8, 9])], { type: 'image/jpeg' }), 'product.jpg');
  data.set('title', 'صورة المنتج');
  const request = new Request('http://localhost/api/test', { method: 'POST', body: data });
  assert.equal(await rejectOversizedRequest(request, 4096), null);
  const parsed = await request.formData();
  assert.equal(parsed.get('title'), 'صورة المنتج');
  const image = parsed.get('image');
  assert.ok(image instanceof File);
  assert.equal(image.name, 'product.jpg');
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [0xff, 0xd8, 0xff, 7, 8, 9]);
});

test('stops an oversized stream and cancels its source without waiting for more bytes', { timeout: 3000 }, async () => {
  let pulls = 0;
  let cancelled = false;
  const request = streamedRequest(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(256)); },
    cancel() { cancelled = true; },
  }));
  const response = await rejectOversizedRequest(request, 1024);
  assert.equal(response?.status, 413);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pulls < 20, `The guard kept reading after rejection: ${pulls} pulls`);
  assert.equal(cancelled, true);
});

test('cancels declared oversized input without reading its body', async () => {
  let pulls = 0;
  let cancelled = false;
  const request = streamedRequest(new ReadableStream({
    pull() { pulls++; }, cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { headers: { 'content-length': '2048' } });
  assert.equal((await rejectOversizedRequest(request, 1024))?.status, 413);
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
});

test('aborting a stalled body ends the check and releases the pending stream', { timeout: 3000 }, async () => {
  const controller = new AbortController();
  let cancelled = false;
  const request = streamedRequest(new ReadableStream({ cancel() { cancelled = true; } }), { signal: controller.signal });
  const pending = rejectOversizedRequest(request, 1024);
  controller.abort();
  assert.equal((await pending)?.status, 408);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('body read failures do not leak stream errors or leave the caller waiting', async () => {
  const request = streamedRequest(new ReadableStream({ start(controller) { controller.error(new Error('private upstream diagnostics')); } }));
  const response = await rejectOversizedRequest(request, 1024);
  assert.equal(response?.status, 400);
  assert.doesNotMatch(await response!.text(), /private upstream/);
});

test('the agreement endpoint rejects oversized real JSON without a size header', async () => {
  const request = new Request('http://localhost/api/auth/commission-agreement', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accepted: true, ignored: 'x'.repeat(2048) }),
  });
  assert.equal((await acceptCommissionAgreement(request)).status, 413);
});

test('rejects oversized JSON API requests before parsing the body', async () => {
  const request = new Request(
    'http://localhost/api/auth/commission-agreement',
    {
      method: 'POST',
      headers: {
        'content-length': '1025',
        'content-type': 'application/json',
      },
      body: '{"accepted":true}',
    },
  );

  const response = await acceptCommissionAgreement(request);

  assert.equal(response.status, 413);
});
