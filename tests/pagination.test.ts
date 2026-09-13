import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePagination } from '@/lib/pagination';

test('caps very large marketplace pagination offsets', () => {
  const pagination = normalizePagination(
    { page: '999999999', limit: '500' },
    { defaultLimit: 24, maxLimit: 48 },
  );

  assert.equal(pagination.page, 1000);
  assert.equal(pagination.limit, 48);
  assert.equal(pagination.skip, 999 * 48);
  assert.equal(pagination.take, 49);
});
