import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultMaxListingImages,
  getMaxListingImagesPerListing,
  maxConfigurableListingImages,
} from '@/agent/marketplace/listing-image-limits';

function withImageLimitEnv(value: string | undefined, assertion: () => void) {
  const originalValue = process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;

  try {
    if (value === undefined) {
      delete process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
    } else {
      process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING = value;
    }

    assertion();
  } finally {
    if (originalValue === undefined) {
      delete process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
    } else {
      process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING = originalValue;
    }
  }
}

test('uses the default listing image limit when the env value is missing or invalid', () => {
  withImageLimitEnv(undefined, () => {
    assert.equal(getMaxListingImagesPerListing(), defaultMaxListingImages);
  });

  withImageLimitEnv('0', () => {
    assert.equal(getMaxListingImagesPerListing(), defaultMaxListingImages);
  });

  withImageLimitEnv('not-a-number', () => {
    assert.equal(getMaxListingImagesPerListing(), defaultMaxListingImages);
  });
});

test('allows a configured listing image limit up to the hard cap', () => {
  withImageLimitEnv('5', () => {
    assert.equal(getMaxListingImagesPerListing(), 5);
  });

  withImageLimitEnv('100', () => {
    assert.equal(getMaxListingImagesPerListing(), maxConfigurableListingImages);
  });
});
