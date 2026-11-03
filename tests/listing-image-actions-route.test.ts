import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { PATCH, DELETE } from '@/app/api/marketplace/listings/[listingId]/images/[imageId]/route';
import { addListingImageForSeller, createListingDraft, getListing, resetMarketplaceStoreForTests } from '@/agent/marketplace/store';
import { createSignedSession } from '@/lib/auth/session';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

function fixture(t: TestContext) {
  const environment = {
    SMARTSTORE_MARKETPLACE_STORE: 'file', AUTH_SECRET: 'isolated-image-actions-route-tests-only',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    resetMarketplaceStoreForTests();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  mockAllowedTextAnalysis(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External IO is forbidden in image route tests'); });
  resetMarketplaceStoreForTests();
  const suffix = randomUUID();
  const owner = `image-action-owner-${suffix}`;
  const stranger = `image-action-stranger-${suffix}`;
  const listing = createListingDraft({ sellerId: owner, category: 'furniture', title: 'Owned image action fixture' });
  const anotherListing = createListingDraft({ sellerId: owner, category: 'furniture', title: 'Another owned listing fixture' });
  const foreignListing = createListingDraft({ sellerId: stranger, category: 'furniture', title: 'Foreign listing fixture' });
  const add = (listingId: string, sellerId: string, imageId: string, primary: boolean) => {
    const url = `https://images.example.invalid/${imageId}.webp`;
    addListingImageForSeller(listingId, sellerId, {
      id: imageId, listingId, originalUrl: url, displayUrl: url,
      thumbnailUrl: url, isPrimary: primary, status: 'approved', qualityScore: 100, enhancements: [],
    });
  };
  const imageA = `photo-a-${suffix}`, imageB = `photo-b-${suffix}`;
  const otherImage = `photo-other-${suffix}`, foreignImage = `photo-foreign-${suffix}`;
  add(listing.id, owner, imageA, true); add(listing.id, owner, imageB, false);
  add(anotherListing.id, owner, otherImage, true); add(foreignListing.id, stranger, foreignImage, true);
  const request = (method: string, listingId: string, imageId: string, options: {
    actor?: string | null; body?: unknown; rawBody?: string; key?: string; contentLength?: string;
  } = {}) => {
    const actor = options.actor === undefined ? owner : options.actor;
    return new Request(`http://localhost/api/marketplace/listings/${listingId}/images/${imageId}`, {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${createSignedSession({ id: actor, email: `${actor}@example.test` })}` } : {}),
        'Content-Type': 'application/json',
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
        ...(options.contentLength ? { 'Content-Length': options.contentLength } : {}),
      },
      ...(options.rawBody !== undefined ? { body: options.rawBody }
        : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  };
  const context = (listingId: string, imageId: string) => ({ params: Promise.resolve({ listingId, imageId }) });
  const snapshot = () => structuredClone([getListing(listing.id), getListing(anotherListing.id), getListing(foreignListing.id)]);
  return { owner, stranger, listing, anotherListing, foreignListing, imageA, imageB, otherImage, foreignImage,
    add, request, context, snapshot };
}

test('image action handlers reject guests, foreign listing owners and foreign image IDs without mutation', async t => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const [method, handler] of [['PATCH', PATCH], ['DELETE', DELETE]] as const) {
    const call = (listingId: string, imageId: string, actor: string | null) => handler(
      f.request(method, listingId, imageId, { actor, ...(method === 'PATCH' ? { body: { action: 'set_primary' } } : {}) }),
      f.context(listingId, imageId));
    assert.equal((await call(f.listing.id, f.imageA, null)).status, 401);
    for (const [listingId, imageId, actor] of [
      [f.listing.id, f.imageA, f.stranger],
      [f.foreignListing.id, f.foreignImage, f.owner],
      [f.listing.id, f.otherImage, f.owner],
      [f.listing.id, f.foreignImage, f.owner],
      [f.listing.id, 'missing-image', f.owner],
      ['missing-listing', f.imageA, f.owner],
    ]) {
      const response = await call(listingId, imageId, actor);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'listing_or_image_not_found' });
    }
    assert.deepEqual(f.snapshot(), before, `${method} failures cannot change any image or listing`);
  }
});

test('image primary handler validates JSON, action and request size before changing the selected image', async t => {
  const f = fixture(t), before = f.snapshot();
  const cases = [
    { options: { rawBody: '{' }, status: 400, error: 'invalid_json' },
    { options: { body: { action: 'delete' } }, status: 400, error: 'invalid_request' },
    { options: { body: {} }, status: 400, error: 'invalid_request' },
    { options: { body: { action: 'set_primary' }, contentLength: '4097' }, status: 413, error: 'Request body is too large.' },
  ];
  for (const entry of cases) {
    const response = await PATCH(f.request('PATCH', f.listing.id, f.imageB, entry.options), f.context(f.listing.id, f.imageB));
    assert.equal(response.status, entry.status);
    if (entry.status === 413) assert.equal(await response.text(), entry.error);
    else assert.equal((await response.json()).error, entry.error);
    assert.deepEqual(f.snapshot(), before);
  }
});

test('image primary handler persists one selected photo and replays a key without overriding a later selection', async t => {
  const f = fixture(t), key = `image-primary-${randomUUID()}`;
  const choose = (imageId: string, operationKey: string) => PATCH(f.request('PATCH', f.listing.id, imageId, {
    key: operationKey, body: { action: 'set_primary' },
  }), f.context(f.listing.id, imageId));
  const first = await choose(f.imageB, key);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(firstBody.listing.images.filter((image: { isPrimary: boolean }) => image.isPrimary)
    .map((image: { id: string }) => image.id), [f.imageB]);
  assert.deepEqual(getListing(f.listing.id)!.images.filter(image => image.isPrimary).map(image => image.id), [f.imageB]);
  assert.equal((await choose(f.imageA, `new-${key}`)).status, 200);
  const afterNewSelection = f.snapshot();
  const repeated = await choose(f.imageB, key);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), firstBody);
  assert.deepEqual(f.snapshot(), afterNewSelection, 'a replay returns its receipt without reapplying the old primary');
});

test('image deletion handler promotes the remaining photo and replays a key without deleting newer photos', async t => {
  const f = fixture(t), key = `image-delete-${randomUUID()}`;
  const remove = (operationKey: string) => DELETE(f.request('DELETE', f.listing.id, f.imageA, { key: operationKey }),
    f.context(f.listing.id, f.imageA));
  const first = await remove(key);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(firstBody.listing.images.map((image: { id: string }) => image.id), [f.imageB]);
  assert.equal(firstBody.listing.images[0].isPrimary, true);
  assert.deepEqual(getListing(f.listing.id)!.images.map(image => image.id), [f.imageB]);
  f.add(f.listing.id, f.owner, `newer-${f.imageA}`, false);
  const afterNewPhoto = f.snapshot();
  const repeated = await remove(key);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), firstBody);
  assert.deepEqual(f.snapshot(), afterNewPhoto);
  const freshAttempt = await remove(`new-${key}`);
  assert.equal(freshAttempt.status, 404);
  assert.deepEqual(f.snapshot(), afterNewPhoto);
});
