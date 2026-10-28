import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import sharp from 'sharp';

import { POST } from '@/app/api/marketplace/listings/[listingId]/images/route';
import { createListingImageVariants, createSanitizedListingImageOriginal } from '@/agent/marketplace/listing-image-variants';
import { discardUnattachedListingImage, saveUploadedListingImagesForSeller, storeListingImageDelivery } from '@/agent/marketplace/listing-image-storage';
import { storeListingObject } from '@/agent/marketplace/object-storage';
import { addListingImageForSeller, createListingDraft, getListing } from '@/agent/marketplace/store';
import { createSessionCookie } from '@/lib/auth/session';
import { mockImageContentReview } from './helpers/image-content';

function storageEnvironment(t: TestContext) {
  const values = {
    SMARTSTORE_IMAGE_STORAGE: 's3', SMARTSTORE_MARKETPLACE_STORE: 'file',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'images', SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.test',
    CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ZONE_ID: '',
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function sample() {
  const data = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const input = { data: new Uint8Array(data), mediaType: 'image/png', fileName: 'desk.png' };
  return { input, original: await createSanitizedListingImageOriginal(input), variants: await createListingImageVariants(input) };
}

for (const failed of ['display', 'thumbnail'] as const) {
  test(`rejects incomplete delivery and removes the saved siblings after ${failed} exhausts retries`, async t => {
    storageEnvironment(t);
    const writes: string[] = [];
    const deletes: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') { deletes.push(url); return new Response(null, { status: 204 }); }
      writes.push(url);
      return new Response(null, { status: url.includes(`-${failed}.webp`) ? 503 : 200 });
    });
    const { original, variants } = await sample();
    await assert.rejects(storeListingImageDelivery({ imageId: 'recovery', original, variants }), /could not be stored completely/);
    assert.equal(writes.length, 4, 'only the failed variant is retried twice');
    assert.equal(deletes.length, 1);
    assert.ok(deletes.every(url => !url.includes(`-${failed}.webp`)));
  });
}

test('chat continues with later complete images after a display derivative exhausts retries', async t => {
  storageEnvironment(t);
  let firstDisplayPath: string | undefined;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('-display.webp')) firstDisplayPath ??= path;
    return new Response(null, { status: path === firstDisplayPath ? 503 : 200 });
  });
  const listing = createListingDraft({ sellerId: 'recovery-chat', category: 'other', title: 'Desk' });
  const { input } = await sample();
  const result = await saveUploadedListingImagesForSeller({ listingId: listing.id, sellerId: listing.sellerId, images: [input, input, input] });
  assert.equal(result?.images.length, 2);
  assert.ok(result?.images.every(image => image.thumbnailUrl.endsWith('-thumbnail.webp')));
});

test('transient variant failure recovers without storing original-sized aliases', async t => {
  storageEnvironment(t);
  let displayAttempts = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const display = new URL(String(input)).pathname.endsWith('-display.webp');
    return new Response(null, { status: display && ++displayAttempts === 1 ? 503 : 200 });
  });
  const { original, variants } = await sample();
  const result = await storeListingImageDelivery({ imageId: 'transient-variant', original, variants });
  assert.equal(displayAttempts, 2);
  assert.match(result!.displayUrl, /-display\.webp$/);
  assert.match(result!.thumbnailUrl, /-thumbnail\.webp$/);
  assert.equal(result!.originalUrl, result!.displayUrl);
});

test('failed shared chat delivery does not delete objects a concurrent retry may attach', async t => {
  storageEnvironment(t);
  let deletes = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'DELETE') deletes++;
    return new Response(null, { status: String(input).includes('-display.webp') ? 503 : 200 });
  });
  const listing = createListingDraft({ sellerId: 'shared-draft-recovery', category: 'other', title: 'Desk' });
  const { input } = await sample();
  await assert.rejects(saveUploadedListingImagesForSeller({ listingId: listing.id, sellerId: listing.sellerId, images: [input], draftOnly: true }));
  assert.equal(getListing(listing.id)?.images.length, 0);
  assert.equal(deletes, 0);
});

test('incomplete upload is not attached and the same idempotency key can retry successfully', async t => {
  storageEnvironment(t);
  mockImageContentReview(t, 'allow');
  const providerFetch = globalThis.fetch;
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (!new URL(String(input)).hostname.endsWith('r2.cloudflarestorage.com')) return providerFetch(input, init);
    return new Response(null, { status: init?.method === 'PUT' && fail && String(input).includes('-display.webp') ? 503 : 200 });
  });
  const listing = createListingDraft({ sellerId: 'incomplete-upload-owner', category: 'other', title: 'Desk' });
  const cookie = createSessionCookie({ id: listing.sellerId, email: 'incomplete@example.test' });
  const { input } = await sample();
  const upload = () => {
    const body = new FormData();
    body.set('image', new File([input.data as Uint8Array<ArrayBuffer>], 'desk.png', { type: input.mediaType }));
    return POST(new Request('https://smartstore.test/upload', {
      method: 'POST', headers: { cookie, 'Idempotency-Key': 'recover-incomplete-delivery' }, body,
    }), { params: Promise.resolve({ listingId: listing.id }) });
  };
  assert.equal((await upload()).status, 503);
  assert.equal(getListing(listing.id)?.images.length, 0);
  fail = false;
  assert.equal((await upload()).status, 201);
  assert.equal(getListing(listing.id)?.images.length, 1);
  assert.match(getListing(listing.id)!.images[0].displayUrl, /-display\.webp$/);
});

test('missing or invalid public image URL fails before writing an object', async t => {
  storageEnvironment(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(null, { status: 200 }); });
  for (const url of ['', 'not a url', 'https://images.example.test/?token=secret']) {
    process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL = url;
    await assert.rejects(storeListingObject({ imageId: 'invalid-config', data: new Uint8Array([1]), mediaType: 'image/png' }));
  }
  assert.equal(requests, 0);
});

test('cleanup never deletes an image already attached to its listing', async t => {
  storageEnvironment(t);
  const listing = createListingDraft({ sellerId: 'recovery-cleanup', category: 'other', title: 'Desk' });
  const image = {
    id: 'attached-image', listingId: listing.id, originalUrl: 'https://images.example.test/listings/attached.jpg',
    displayUrl: 'https://images.example.test/listings/attached-display.webp',
    thumbnailUrl: 'https://images.example.test/listings/attached-thumbnail.webp',
    isPrimary: true, status: 'approved' as const, qualityScore: 90, enhancements: [],
  };
  addListingImageForSeller(listing.id, listing.sellerId, image);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(null, { status: 200 }); });
  await discardUnattachedListingImage(image);
  assert.equal(requests, 0);
  assert.equal(getListing(listing.id)?.images.length, 1);
});

test('security rejection completes idempotency rather than leaving the upload pending', async t => {
  storageEnvironment(t);
  const listing = createListingDraft({ sellerId: 'recovery-security', category: 'other', title: 'Desk' });
  const cookie = createSessionCookie({ id: listing.sellerId, email: 'security@example.test' });
  for (let index = 0; index < 2; index++) {
    const body = new FormData();
    body.set('image', new File(['not an image'], 'bad.png', { type: 'image/png' }));
    const response = await POST(new Request('https://smartstore.test/upload', {
      method: 'POST', headers: { cookie, 'Idempotency-Key': 'invalid-same-key' }, body,
    }), { params: Promise.resolve({ listingId: listing.id }) });
    assert.equal(response.status, 415);
  }
});

test('concurrent uploads report the actual saved image and clean up the rejected objects', async t => {
  storageEnvironment(t);
  const listing = createListingDraft({ sellerId: 'recovery-concurrent', category: 'other', title: 'Desk' });
  for (let index = 0; index < 7; index++) {
    addListingImageForSeller(listing.id, listing.sellerId, {
      id: `existing-${index}`, listingId: listing.id, originalUrl: `https://images.example.test/existing-${index}.jpg`,
      displayUrl: '', thumbnailUrl: '', isPrimary: index === 0, status: 'approved', qualityScore: 90, enhancements: [],
    });
  }
  mockImageContentReview(t, 'allow');
  const previousFetch = globalThis.fetch;
  let started = 0;
  let release!: () => void;
  const bothStarted = new Promise<void>(resolve => { release = resolve; });
  const deleted: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.hostname.endsWith('r2.cloudflarestorage.com')) return previousFetch(input, init);
    if (init?.method === 'DELETE') deleted.push(url.pathname);
    if (init?.method === 'PUT' && url.pathname.endsWith('.webp') && !/-(?:display|thumbnail)\.webp$/.test(url.pathname)) {
      if (++started === 2) release();
      await bothStarted;
    }
    return new Response(null, { status: 200 });
  });
  const { input } = await sample();
  const cookie = createSessionCookie({ id: listing.sellerId, email: 'concurrent@example.test' });
  const upload = () => {
    const body = new FormData();
    body.set('image', new File([input.data as Uint8Array<ArrayBuffer>], 'desk.png', { type: input.mediaType }));
    return POST(new Request('https://smartstore.test/upload', { method: 'POST', headers: { cookie }, body }), { params: Promise.resolve({ listingId: listing.id }) });
  };
  const responses = await Promise.all([upload(), upload()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal(getListing(listing.id)?.images.length, 8);
  assert.equal(deleted.length, 2);
  const savedResponse = responses.find(response => response.status === 201)!;
  const payload = await savedResponse.json();
  assert.ok(getListing(listing.id)?.images.some(image => image.id === payload.image.id));
});

test('replays the final allowed upload after a lost response without adding another image', async t => {
  storageEnvironment(t);
  const listing = createListingDraft({ sellerId: 'recovery-final-upload', category: 'other', title: 'Desk' });
  for (let index = 0; index < 7; index++) {
    addListingImageForSeller(listing.id, listing.sellerId, {
      id: `before-replay-${index}`, listingId: listing.id,
      originalUrl: `https://images.example.test/before-replay-${index}.jpg`,
      displayUrl: '', thumbnailUrl: '', isPrimary: index === 0,
      status: 'approved', qualityScore: 90, enhancements: [],
    });
  }
  mockImageContentReview(t, 'allow');
  const providerFetch = globalThis.fetch;
  let objectWrites = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (!new URL(String(input)).hostname.endsWith('r2.cloudflarestorage.com')) return providerFetch(input, init);
    if (init?.method === 'PUT') objectWrites++;
    return new Response(null, { status: 200 });
  });
  const { input } = await sample();
  const cookie = createSessionCookie({ id: listing.sellerId, email: 'final-upload@example.test' });
  const upload = (key: string) => {
    const body = new FormData();
    body.set('image', new File([input.data as Uint8Array<ArrayBuffer>], 'desk.png', { type: input.mediaType }));
    return POST(new Request('https://smartstore.test/upload', {
      method: 'POST', headers: { cookie, 'Idempotency-Key': key }, body,
    }), { params: Promise.resolve({ listingId: listing.id }) });
  };
  const first = await upload('final-upload-same-key');
  assert.equal(first.status, 201);
  const saved = await first.json();
  assert.equal(getListing(listing.id)?.images.length, 8);

  // Simulate a client that never received the successful response and retries.
  const replay = await upload('final-upload-same-key');
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).image.id, saved.image.id);
  assert.equal(getListing(listing.id)?.images.length, 8);
  assert.equal(objectWrites, 2, 'replay must not upload any additional variants');

  const additional = await upload('another-image-new-key');
  assert.equal(additional.status, 409);
  assert.equal((await additional.json()).error, 'listing_image_limit_reached');
});
