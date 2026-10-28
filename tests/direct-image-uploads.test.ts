import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  directImageUploadLifetimeMs, imageUploadFingerprint, imageUploadObjectKeys,
  imageUploadTargetAllowed, isImageUploadActive, verifyImageWorkerSecret,
  retryDirectImageTransaction,
} from '@/agent/marketplace/direct-image-upload-policy';
import { directImageCompleteInput, directImageUploadInput, getOwnedActiveDirectImageUploads } from '@/agent/marketplace/direct-image-uploads';
import { createListingDraft, setListingStatusForSeller } from '@/agent/marketplace/store';
import { prisma } from '@/lib/db/prisma';
import { POST as startUpload, GET as listUploads } from '@/app/api/marketplace/listings/[listingId]/image-uploads/route';
import { GET as getUpload, DELETE as cancelUpload } from '@/app/api/marketplace/listings/[listingId]/image-uploads/[uploadId]/route';
import { POST as claim } from '@/app/api/internal/image-uploads/[uploadId]/claim/route';
import { POST as complete } from '@/app/api/internal/image-uploads/[uploadId]/complete/route';
import { POST as cleanup } from '@/app/api/internal/image-uploads/cleanup/route';
import { createSessionCookie } from '@/lib/auth/session';

test('direct image requests accept only bounded JPEG metadata and content fingerprints', () => {
  const input = { fileName: 'image.jpg', mediaType: 'image/jpeg', sizeBytes: 12 * 1024 * 1024, sha256: 'a'.repeat(64) };
  assert.equal(directImageUploadInput.safeParse(input).success, true);
  for (const changes of [{ sizeBytes: 0 }, { sizeBytes: input.sizeBytes + 1 }, { mediaType: 'image/svg+xml' }, { sha256: 'not-a-hash' }, { sellerId: 'someone-else' }]) {
    assert.equal(directImageUploadInput.safeParse({ ...input, ...changes }).success, false);
  }
  assert.equal(imageUploadFingerprint(input), imageUploadFingerprint({ ...input }));
  assert.notEqual(imageUploadFingerprint(input), imageUploadFingerprint({ ...input, sha256: 'b'.repeat(64) }));
  assert.equal(directImageCompleteInput.safeParse({ leaseToken: randomUUID(), retryable: true }).success, false);
});

test('only the original live owner can attach images; rejected listings remain editable', () => {
  const listing = { sellerId: 'owner', status: 'draft', compliance: { humanDecision: 'allow' } };
  const owner = { deletedAt: null };
  assert.equal(imageUploadTargetAllowed(listing, 'owner', owner), true);
  assert.equal(imageUploadTargetAllowed(listing, 'other', owner), false);
  assert.equal(imageUploadTargetAllowed(listing, 'owner', { deletedAt: new Date() }), false);
  assert.equal(imageUploadTargetAllowed({ ...listing, status: 'deleted' }, 'owner', owner), false);
  assert.equal(imageUploadTargetAllowed({ ...listing, status: 'rejected', compliance: { humanDecision: 'block' } }, 'owner', owner), true);
  assert.equal(isImageUploadActive({ status: 'pending', expiresAt: new Date(Date.now() + directImageUploadLifetimeMs) }), true);
  assert.equal(isImageUploadActive({ status: 'processing', expiresAt: new Date(0) }), false);
  assert.equal(isImageUploadActive({ status: 'cancelled', expiresAt: new Date(Date.now() + 1000) }), false);
  assert.notDeepEqual(imageUploadObjectKeys('one', 'lease-one'), imageUploadObjectKeys('one', 'lease-two'));
});

test('Worker authorization is separate from customer sessions and refuses missing or short secrets', () => {
  const secret = 'isolated-image-worker-secret-of-32-characters';
  assert.equal(verifyImageWorkerSecret(`Bearer ${secret}`, secret), true);
  for (const given of [null, secret, `Bearer ${secret}x`, 'Bearer forged', `Basic ${secret}`]) {
    assert.equal(verifyImageWorkerSecret(given, secret), false);
  }
  assert.equal(verifyImageWorkerSecret('Bearer short', 'short'), false);
  assert.equal(verifyImageWorkerSecret(`Bearer ${secret}`, undefined), false);
});

test('public upload methods reject guests before touching jobs or external storage', async () => {
  const context = { params: Promise.resolve({ listingId: 'missing', uploadId: 'missing' }) };
  for (const [method, handler] of [['POST', startUpload], ['GET', listUploads], ['GET', getUpload], ['DELETE', cancelUpload]] as const) {
    const response = await handler(new Request('http://localhost/api/marketplace/listings/missing/image-uploads/missing', { method }), context);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'auth_required');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  }
});

test('Worker routes reject customer cookies and forged bearer credentials before database access', async () => {
  const previous = process.env.SMARTSTORE_IMAGE_WORKER_SECRET;
  process.env.SMARTSTORE_IMAGE_WORKER_SECRET = 'isolated-image-worker-secret-of-32-characters';
  const cookie = createSessionCookie({ id: 'ordinary', email: 'ordinary@example.test', role: 'user' }).split(';')[0];
  try {
    const credentialVariants: HeadersInit[] = [{}, { Cookie: cookie }, { Authorization: 'Bearer forged' }];
    for (const handler of [claim, complete, cleanup]) for (const headers of credentialVariants) {
      const response = await handler(new Request('http://localhost/api/internal/image-uploads/missing/claim', { method: 'POST', headers }), { params: Promise.resolve({ uploadId: 'missing' }) });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'worker_auth_required');
    }
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_IMAGE_WORKER_SECRET; else process.env.SMARTSTORE_IMAGE_WORKER_SECRET = previous;
  }
});

test('serializable upload guards retry only transaction conflicts when the new protocol is enabled', async () => {
  const previousFlag = process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS;
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'true';
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    let attempts = 0;
    const answer = await retryDirectImageTransaction(async () => {
      if (++attempts < 3) throw Object.assign(new Error('conflict'), { code: 'P2034' });
      return 42;
    });
    assert.equal(answer, 42);
    assert.equal(attempts, 3);
    attempts = 0;
    await assert.rejects(retryDirectImageTransaction(async () => { attempts++; throw Object.assign(new Error('missing'), { code: 'P2025' }); }), { code: 'P2025' });
    assert.equal(attempts, 1);
    process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'false';
    attempts = 0;
    await assert.rejects(retryDirectImageTransaction(async () => { attempts++; throw Object.assign(new Error('conflict'), { code: 'P2034' }); }), { code: 'P2034' });
    assert.equal(attempts, 1);
  } finally {
    if (previousFlag === undefined) delete process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS; else process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = previousFlag;
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  }
});

test('file-mode recovery keeps local listing edits usable without touching Prisma', async t => {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.mock.method(prisma, '$transaction', async () => { throw new Error('file_mode_must_not_query_database'); });
  try {
    const listing = createListingDraft({ sellerId: `file-direct-${randomUUID()}`, category: 'furniture', title: 'كنب' });
    assert.deepEqual(await getOwnedActiveDirectImageUploads(listing.id, listing.sellerId), { uploads: [] });
    await assert.rejects(getOwnedActiveDirectImageUploads(listing.id, 'someone-else'), { code: 'listing_not_found' });
    await assert.rejects(getOwnedActiveDirectImageUploads('missing-file-listing', listing.sellerId), { code: 'listing_not_found' });
    setListingStatusForSeller(listing.id, listing.sellerId, 'deleted');
    await assert.rejects(getOwnedActiveDirectImageUploads(listing.id, listing.sellerId), { code: 'listing_not_found' });
  } finally {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  }
});
