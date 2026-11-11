import assert from 'node:assert/strict';
import test from 'node:test';

import { activePublishedFavoriteWhere } from '@/lib/marketplace/favorite-visibility';

test('database favorites exclude listings whose seller account is deactivated', () => {
  assert.deepEqual(activePublishedFavoriteWhere('buyer'), {
    userId: 'buyer',
    listing: { status: 'published', seller: { deletedAt: null } },
  });
});
