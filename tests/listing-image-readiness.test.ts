import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import sharp from 'sharp';
import {
  ListingImageDeliveryUnavailableError,
  verifyListingImageDelivery,
} from '@/agent/marketplace/listing-image-readiness';

const publicBase = 'https://images.example.test/media';
const urls = {
  displayUrl: `${publicBase}/listings/2026/11/fixture-display.webp`,
  thumbnailUrl: `${publicBase}/listings/2026/11/fixture-thumbnail.webp`,
};
const webp = sharp({ create: { width: 32, height: 24, channels: 3, background: '#19735f' } }).webp().toBuffer();

function configure(t: TestContext) {
  const previous = process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL;
  process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL = publicBase;
  t.after(() => {
    if (previous === undefined) delete process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL;
    else process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL = previous;
  });
}

function imageResponse(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', ...headers } });
}

function unavailable(work: Promise<unknown>) {
  return assert.rejects(work, ListingImageDeliveryUnavailableError);
}

test('delivery readiness loads both exact public WebP URLs without origin credentials or cache-busting', async t => {
  configure(t);
  const bytes = await webp;
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(Object.values(urls).includes(url));
    assert.equal(new URL(url).search, '');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init?.headers);
    for (const name of ['authorization', 'cookie', 'proxy-authorization']) assert.equal(headers.has(name), false);
    seen.push(url);
    return imageResponse(bytes, { 'Content-Length': String(bytes.byteLength) });
  });
  await verifyListingImageDelivery(urls);
  assert.deepEqual(seen.sort(), Object.values(urls).sort());
});

test('a transient public response retries only the unavailable sibling and keeps the final URL unchanged', async t => {
  configure(t);
  const bytes = await webp;
  const requests = new Map<string, number>();
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input), count = (requests.get(url) ?? 0) + 1;
    requests.set(url, count);
    return url === urls.thumbnailUrl && count === 1
      ? new Response(null, { status: 404 }) : imageResponse(bytes);
  });
  await verifyListingImageDelivery(urls);
  assert.equal(requests.get(urls.displayUrl), 1);
  assert.equal(requests.get(urls.thumbnailUrl), 2);
});

test('one exhausted sibling prevents readiness after all three attempts settle', async t => {
  configure(t);
  const bytes = await webp;
  let display = 0, thumbnail = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input) === urls.displayUrl) { display++; return imageResponse(bytes); }
    thumbnail++;
    return new Response(null, { status: 503 });
  });
  await unavailable(verifyListingImageDelivery(urls));
  assert.equal(display, 1);
  assert.equal(thumbnail, 3);
});

test('readiness waits for both public reads and does not return when the first variant succeeds', async t => {
  configure(t);
  const bytes = await webp;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let thumbnailStarted!: () => void;
  const started = new Promise<void>(resolve => { thumbnailStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input) === urls.thumbnailUrl) { thumbnailStarted(); await gate; }
    return imageResponse(bytes);
  });
  let settled = false;
  const pending = verifyListingImageDelivery(urls).then(() => { settled = true; });
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await pending;
  assert.equal(settled, true);
});

test('unusable public bodies never satisfy readiness', async t => {
  const bytes = await webp;
  const cases: Array<{ name: string; response: () => Response }> = [
    { name: 'HTML with a successful HTTP status', response: () => new Response('<html>Challenge</html>', { headers: { 'Content-Type': 'text/html' } }) },
    { name: 'HTML falsely labelled as WebP', response: () => imageResponse(Buffer.from('<html>Not an image</html>')) },
    { name: 'corrupt WebP bytes', response: () => imageResponse(new Uint8Array([1, 2, 3, 4])) },
    { name: 'truncated WebP with matching transport size', response: () => imageResponse(bytes.subarray(0, bytes.byteLength - 10)) },
    { name: 'empty body', response: () => imageResponse(new Uint8Array()) },
    { name: 'transport content-length mismatch', response: () => imageResponse(bytes, { 'Content-Length': String(bytes.byteLength + 1) }) },
    { name: 'zero declared content-length', response: () => imageResponse(bytes, { 'Content-Length': '0' }) },
    { name: 'declared content-length exceeds limit', response: () => imageResponse(bytes, { 'Content-Length': String(12 * 1024 * 1024 + 1) }) },
    { name: 'missing response body', response: () => new Response(null, { headers: { 'Content-Type': 'image/webp' } }) },
    { name: 'redirect response', response: () => new Response(null, { status: 302, headers: { Location: 'https://other.example.test/image.webp' } }) },
    { name: 'already redirected response', response: () => {
      const result = imageResponse(bytes);
      Object.defineProperty(result, 'redirected', { value: true });
      return result;
    } },
  ];
  for (const fixture of cases) await t.test(fixture.name, async child => {
    configure(child);
    child.mock.method(globalThis, 'fetch', async () => fixture.response());
    // An insufficient retry budget still exercises the complete first response.
    await unavailable(verifyListingImageDelivery(urls, Date.now() + 100));
  });
});

test('streamed bodies are bounded independently of content-length and are cancelled on overflow', async t => {
  configure(t);
  let cancelled = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(12 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled++; },
  }), { headers: { 'Content-Type': 'image/webp' } }));
  await unavailable(verifyListingImageDelivery(urls, Date.now() + 100));
  assert.equal(cancelled, 2);
});

test('each delivery variant must fit its own dimensions', async t => {
  const valid = await webp;
  for (const [name, displayBytes, thumbnailBytes] of [
    ['oversized display', await sharp({ create: { width: 901, height: 1, channels: 3, background: '#123456' } }).webp().toBuffer(), valid],
    ['oversized thumbnail', valid, await sharp({ create: { width: 361, height: 1, channels: 3, background: '#123456' } }).webp().toBuffer()],
  ] as const) await t.test(name, async child => {
    configure(child);
    child.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => imageResponse(String(input) === urls.displayUrl ? displayBytes : thumbnailBytes));
    await unavailable(verifyListingImageDelivery(urls, Date.now() + 100));
  });
});

test('foreign origins, escaped prefixes, credentials, queries and fragments are rejected before any public request', async t => {
  configure(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No request should start'); });
  for (const invalid of [
    'https://evil.example.test/media/listings/x.webp',
    'http://images.example.test/media/listings/x.webp',
    'https://user:password@images.example.test/media/listings/x.webp',
    'https://images.example.test/media-listings/x.webp',
    'https://images.example.test/media/listings/../profiles/x.webp',
    `${urls.displayUrl}?X-Amz-Signature=must-not-be-sent`,
    `${urls.displayUrl}#fragment`,
  ]) await unavailable(verifyListingImageDelivery({ ...urls, displayUrl: invalid }));
  assert.equal(requests, 0);
});

test('the deadline aborts a stalled body even after successful headers arrive', async t => {
  configure(t);
  const bytes = await webp;
  let signal: AbortSignal | undefined, cancelled = false;
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === urls.displayUrl) return imageResponse(bytes);
    signal = init?.signal ?? undefined;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes.subarray(0, 8)); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'image/webp' } });
  });
  await unavailable(verifyListingImageDelivery(urls, Date.now() + 35));
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, true);
});
