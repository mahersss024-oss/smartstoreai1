import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewListingImageContent } from '@/agent/marketplace/listing-image-content';
import type { ListingImage } from '@/agent/marketplace/types';
import { mockImageContentReview } from './helpers/image-content';

const images = Array.from({ length: 8 }, (_, index) => ({
  data: new Uint8Array([index + 1]), mediaType: 'image/png',
}));

for (const scenario of [
  { name: 'one image', total: 1, decisions: ['needs_review'], calls: 1, status: 'allowed' },
  { name: 'two images', total: 2, decisions: ['needs_review'], calls: 2, status: 'allowed' },
  { name: 'first is clear', total: 8, decisions: ['allow', 'block'], calls: 8, status: 'allowed' },
  { name: 'second is clear', total: 8, decisions: ['needs_review', 'allow', 'block'], calls: 8, status: 'allowed' },
  { name: 'third is clear', total: 8, decisions: ['needs_review', 'needs_review', 'allow', 'block'], calls: 8, status: 'allowed' },
  { name: 'all are unclear', total: 8, decisions: ['needs_review'], calls: 8, status: 'allowed' },
  { name: 'second is prohibited', total: 8, decisions: ['needs_review', 'block'], calls: 8, status: 'allowed' },
  { name: 'inspection is down', total: 8, decisions: ['unavailable'], calls: 1, status: 'unavailable' },
] as const) {
  test(`sequential content inspection: ${scenario.name}`, async (t) => {
    const calls = mockImageContentReview(t, [...scenario.decisions]);
    const review = await reviewListingImageContent(images.slice(0, scenario.total));
    assert.equal(review.status, scenario.status);
    assert.equal(calls(), scenario.calls);
    assert.equal(review.imageReviewStatuses.length, scenario.total);
    if (review.compliance && !review.compliance.inspectionUnavailable) {
      assert.deepEqual(review.compliance.imageProducts?.map(item => item.imageIndex), Array.from({ length: scenario.total }, (_, index) => index));
      assert.ok(review.compliance.imageProducts?.every(item => item.detectedProduct === 'test product'));
    }
    assert.ok(review.imageReviewStatuses.every(status => status === 'clear' || status === 'unclear' || status === 'unavailable'));
  });
}

test('previous clear images do not bypass inspection of subsequently uploaded images', async (t) => {
  const calls = mockImageContentReview(t, 'block');
  const previous = (statuses: string[]) => statuses.map(contentReviewStatus => ({ contentReviewStatus })) as ListingImage[];
  const clear = await reviewListingImageContent(images, previous(['unclear', 'clear']));
  assert.equal(clear.status, 'allowed');
  assert.equal(clear.compliance?.decision, 'block');
  const three = await reviewListingImageContent(images, previous(['unclear', 'unclear', 'unavailable']));
  assert.equal(three.status, 'allowed');
  assert.equal(calls(), 8);
  const remaining = await reviewListingImageContent(images, previous(['unclear', 'unclear']));
  assert.equal(remaining.status, 'allowed');
  assert.equal(calls(), 8);
  await reviewListingImageContent([{ data: new Uint8Array([99]), mediaType: 'image/png' }], previous(['clear']));
  assert.equal(calls(), 9, 'changed image bytes must be inspected again');
});

test('attaching separate photo subsets reuses each existing image assessment without repeating model calls', async t => {
  const calls = mockImageContentReview(t, 'allow');
  await reviewListingImageContent(images);
  assert.equal(calls(), 8);
  await reviewListingImageContent(images.slice(0, 3));
  await reviewListingImageContent(images.slice(3));
  assert.equal(calls(), 8);
});
