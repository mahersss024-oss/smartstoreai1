import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '@/app/api/realtime/stream/route';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

test('sse stream sets the correct streaming headers', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/realtime/stream', {
    signal: controller.signal,
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') ?? '',
    /text\/event-stream/,
  );
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');

  controller.abort();
});

test('sse stream emits a ready event then replays visible events', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/realtime/stream', {
    signal: controller.signal,
  });

  const response = await GET(request);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  const firstRead = await reader.read();
  const firstChunk = decoder.decode(firstRead.value);

  assert.match(firstChunk, /event: ready/);

  publishRealtimeEvent({
    type: 'ad_created',
    payload: { listingId: 'l1', sellerId: 's1', status: 'published' },
    visibility: { includePublic: true },
  });

  // Drain until the published event lands in the stream.
  let buffered = '';
  const deadline = Date.now() + 2000;

  while (Date.now() < deadline && !buffered.includes('ad_created')) {
    const read = await reader.read();

    if (read.done) {
      break;
    }

    buffered += decoder.decode(read.value);
  }

  assert.match(buffered, /ad_created/);

  controller.abort();
  await reader.cancel().catch(() => undefined);
});

test('sse stream filters events the subscriber may not see', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/realtime/stream', {
    signal: controller.signal,
  });

  const response = await GET(request);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  await reader.read(); // ready event

  publishRealtimeEvent({
    type: 'ad_created',
    payload: { listingId: 'private', sellerId: 's2', status: 'published' },
    visibility: { userIds: ['someone-else'] },
  });

  publishRealtimeEvent({
    type: 'ad_created',
    payload: { listingId: 'public', sellerId: 's3', status: 'published' },
    visibility: { includePublic: true },
  });

  let buffered = '';
  const deadline = Date.now() + 2000;

  while (Date.now() < deadline && !buffered.includes('public')) {
    const read = await reader.read();

    if (read.done) {
      break;
    }

    buffered += decoder.decode(read.value);
  }

  assert.match(buffered, /public/);
  assert.doesNotMatch(buffered, /private/);

  controller.abort();
  await reader.cancel().catch(() => undefined);
});
