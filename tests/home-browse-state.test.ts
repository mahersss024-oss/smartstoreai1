import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearHomeBrowseState, getHomeBrowseKey, readHomeBrowseState,
  reloadHomeBrowsePages, writeHomeBrowseState, type HomeBrowseState,
} from '@/lib/marketplace/home-browse-state';
import { clearChatSessionState } from '@/lib/chat/session-state';

function state(): HomeBrowseState<{ id: string }> {
  const filters = { searchInput: 'desk', categoryGroup: 'home', subcategory: 'furniture', city: 'Riyadh' };
  return { ...filters, listings: [{ id: 'one' }, { id: 'two' }], listingsKey: getHomeBrowseKey(filters),
    pagination: { page: 2, hasMore: true }, filterOpen: true, nearbyCity: null,
    viewport: { scrollTop: 870, contentOffset: '180px', toolsHidden: true, categoryWindowStart: 1 } };
}

test('home browsing retains search, filters, loaded results, pagination and viewport separately from chat', () => {
  clearHomeBrowseState();
  assert.equal(readHomeBrowseState(), null);
  const saved = state();
  writeHomeBrowseState(saved);
  clearChatSessionState();
  assert.deepEqual(readHomeBrowseState(), saved);
  clearHomeBrowseState();
  assert.equal(readHomeBrowseState(), null);
});

test('a changed search or filter cannot label old cached results as current', () => {
  const saved = state();
  assert.equal(getHomeBrowseKey({ ...saved, searchInput: ' desk ' }), saved.listingsKey);
  for (const change of [{ searchInput: 'phone' }, { city: 'Jeddah' },
    { categoryGroup: 'all' }, { subcategory: 'all' }, { searchInput: '' }, { categoryOption: 'apple' }]) {
    assert.notEqual(getHomeBrowseKey({ ...saved, ...change }), saved.listingsKey);
  }
});

test('category window navigation is presentation state, not another search filter', () => {
  const saved = state();
  const moved = { ...saved, viewport: { ...saved.viewport, categoryWindowStart: 0 } };
  assert.equal(getHomeBrowseKey(moved), saved.listingsKey);
  writeHomeBrowseState(moved);
  assert.equal(readHomeBrowseState()?.viewport.categoryWindowStart, 0);
  assert.equal(readHomeBrowseState()?.subcategory, saved.subcategory);
  clearHomeBrowseState();
});

test('background restoration reloads the entire previously loaded window and deduplicates shifting pages', async () => {
  const pages: number[] = [];
  const result = await reloadHomeBrowsePages(3, async page => {
    pages.push(page);
    return { listings: [{ id: 'repeated' }, { id: String(page) }], pagination: { page, hasMore: true } };
  });
  assert.deepEqual(pages, [1, 2, 3]);
  assert.deepEqual(result.listings.map(listing => listing.id), ['repeated', '1', '2', '3']);
  assert.deepEqual(result.pagination, { page: 3, hasMore: true });
});

test('restoration stops when the current database results no longer contain the older pages', async () => {
  const result = await reloadHomeBrowsePages(4, async page => {
    assert.equal(page, 1);
    return { listings: [], pagination: { page, hasMore: false } };
  });
  assert.deepEqual(result, { listings: [], pagination: { page: 1, hasMore: false } });
});

test('a failed revalidation cannot partially overwrite the saved result window', async () => {
  const saved = state();
  writeHomeBrowseState(saved);
  await assert.rejects(reloadHomeBrowsePages(2, async page => {
    if (page === 2) throw new Error('offline');
    return { listings: [{ id: 'new' }], pagination: { page, hasMore: true } };
  }), /offline/);
  assert.deepEqual(readHomeBrowseState(), saved);
  clearHomeBrowseState();
});
