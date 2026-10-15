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
  { name: 'first is clear', total: 8, decisions: ['allow', 'block'], calls: 1, status: 'allowed' },
  { name: 'second is clear', total: 8, decisions: ['needs_review', 'allow', 'block'], calls: 2, status: 'allowed' },
  { name: 'third is clear', total: 8, decisions: ['needs_review', 'needs_review', 'allow', 'block'], calls: 3, status: 'allowed' },
  { name: 'all are unclear', total: 8, decisions: ['needs_review'], calls: 3, status: 'allowed' },
  { name: 'second is prohibited', total: 8, decisions: ['needs_review', 'block'], calls: 2, status: 'blocked' },
  { name: 'inspection is down', total: 8, decisions: ['unavailable'], calls: 1, status: 'unavailable' },
] as const) {
  test(`sequential content inspection: ${scenario.name}`, async (t) => {
    const calls = mockImageContentReview(t, [...scenario.decisions]);
    const review = await reviewListingImageContent(images.slice(0, scenario.total));
    assert.equal(review.status, scenario.status);
    assert.equal(calls(), scenario.calls);
    assert.equal(review.imageReviewStatuses.length, scenario.total);
    assert.ok(review.imageReviewStatuses.slice(3).every(status => status === 'not_checked'));
  });
}

test('persisted review progress stops subsequent upload requests after clarity or three images', async (t) => {
  const calls = mockImageContentReview(t, 'block');
  const previous = (statuses: string[]) => statuses.map(contentReviewStatus => ({ contentReviewStatus })) as ListingImage[];
  const clear = await reviewListingImageContent(images, previous(['unclear', 'clear']));
  assert.equal(clear.status, 'skipped');
  const three = await reviewListingImageContent(images, previous(['unclear', 'unclear', 'unavailable']));
  assert.equal(three.status, 'skipped');
  assert.equal(calls(), 0);
  const remaining = await reviewListingImageContent(images, previous(['unclear', 'unclear']));
  assert.equal(remaining.status, 'blocked');
  assert.equal(calls(), 1);
});
