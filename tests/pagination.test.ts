import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePagination, publicMarketplacePaginationOptions } from '@/lib/pagination';

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

test('public marketplace pagination keeps paging beyond 24,000 listings within the database offset range', () => {
  const pagination = normalizePagination(
    { page: '1001', limit: '24' },
    publicMarketplacePaginationOptions,
  );

  assert.equal(pagination.page, 1001);
  assert.equal(pagination.skip, 24_000);
  assert.equal(pagination.take, 25);

  const finalPage = normalizePagination(
    { page: String(Number.MAX_SAFE_INTEGER), limit: '80' },
    publicMarketplacePaginationOptions,
  );
  assert.ok(finalPage.skip <= 2_147_483_647);
});
