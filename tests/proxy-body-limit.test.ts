import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { getCloneableBody, requestToBodyStream } from 'next/dist/server/body-streams';
import nextConfig from '@/next.config';
import { rejectOversizedRequest } from '@/lib/api/request-size';

test('Next proxy preserves a supported 11 MiB image through clone and forwarding', { timeout: 15000 }, async () => {
  const proxyLimit = Number(nextConfig.experimental?.proxyClientMaxBodySize);
  // Preserve the existing largest chat contract, including base64 image data.
  assert.ok(proxyLimit >= 140 * 1024 * 1024);
  const file = new Uint8Array(11 * 1024 * 1024);
  file.set([0xff, 0xd8, 0xff]);
  const data = new FormData();
  data.set('image', new Blob([file], { type: 'image/jpeg' }), 'product.jpg');
  const encoded = new Request('http://localhost/api/upload', { method: 'POST', body: data });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  assert.ok(bytes.byteLength < 13 * 1024 * 1024);
  const original = Readable.from((function* () {
    for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024)
      yield bytes.subarray(offset, offset + 64 * 1024);
  })()) as unknown as IncomingMessage;
  const cloneable = getCloneableBody(original, proxyLimit);
  let cloneBytes = 0;
  for await (const chunk of cloneable.cloneBodyStream()) cloneBytes += chunk.length;
  assert.equal(cloneBytes, bytes.byteLength);
  await cloneable.finalize();
  const forwarded = new Request('http://localhost/api/upload', {
    method: 'POST', headers: encoded.headers,
    body: requestToBodyStream({ ReadableStream }, Uint8Array, original), duplex: 'half',
  } as RequestInit);
  assert.equal(await rejectOversizedRequest(forwarded, 13 * 1024 * 1024), null);
  const uploaded = (await forwarded.formData()).get('image');
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.size, file.byteLength);
  assert.equal(uploaded.name, 'product.jpg');
  assert.deepEqual(new Uint8Array(await uploaded.slice(0, 3).arrayBuffer()), file.slice(0, 3));
});
