import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCanLoadMoreListings,
  getDisplayedListings,
} from '@/lib/chat-listing-display';

test('prefers chat search tool listings when available', () => {
  const marketplaceListings = [{ id: 'api-1' }, { id: 'api-2' }];
  const searchToolListings = [{ id: 'tool-1' }, { id: 'tool-2' }];

  const displayed = getDisplayedListings({
    marketplaceListings,
    searchToolListings,
  });

  assert.deepEqual(displayed, searchToolListings);
});

test('falls back to marketplace listings when chat search tool has no results', () => {
  const marketplaceListings = [{ id: 'api-1' }, { id: 'api-2' }];
  const searchToolListings: Array<{ id: string }> = [];

  const displayed = getDisplayedListings({
    marketplaceListings,
    searchToolListings,
  });

  assert.deepEqual(displayed, marketplaceListings);
});

test('disables load-more when chat search tool listings are being shown', () => {
  const canLoadMore = getCanLoadMoreListings({
    hasMore: true,
    displayedCount: 6,
    hasSearchToolListings: true,
  });

  assert.equal(canLoadMore, false);
});

test('allows load-more only for marketplace list mode with remaining pages', () => {
  const canLoadMore = getCanLoadMoreListings({
    hasMore: true,
    displayedCount: 6,
    hasSearchToolListings: false,
  });

  assert.equal(canLoadMore, true);
});