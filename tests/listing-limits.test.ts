import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultMaxListingsPerSeller,
  getMaxListingsPerSeller,
} from '@/agent/marketplace/listing-limits';

function withListingLimitEnv(value: string | undefined, assertion: () => void) {
  const originalValue = process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER;

  try {
    if (value === undefined) {
      delete process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER;
    } else {
      process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER = value;
    }

    assertion();
  } finally {
    if (originalValue === undefined) {
      delete process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER;
    } else {
      process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER = originalValue;
    }
  }
}

test('uses the default seller listing limit when the env value is missing or invalid', () => {
  withListingLimitEnv(undefined, () => {
    assert.equal(getMaxListingsPerSeller(), defaultMaxListingsPerSeller);
  });

  withListingLimitEnv('0', () => {
    assert.equal(getMaxListingsPerSeller(), defaultMaxListingsPerSeller);
  });

  withListingLimitEnv('not-a-number', () => {
    assert.equal(getMaxListingsPerSeller(), defaultMaxListingsPerSeller);
  });
});

test('uses the configured seller listing limit from the environment', () => {
  withListingLimitEnv('25', () => {
    assert.equal(getMaxListingsPerSeller(), 25);
  });

  withListingLimitEnv('5000', () => {
    assert.equal(getMaxListingsPerSeller(), 5000);
  });
});
