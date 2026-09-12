import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  getAssistantResultListings,
  getCanLoadMoreExploreListings,
  getExploreListings,
} from '@/lib/chat-listing-display';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('limits assistant search listings so chat does not overwhelm the market', () => {
  const searchToolListings = Array.from({ length: 20 }, (_, index) => ({
    id: `tool-${index}`,
  }));

  const displayed = getAssistantResultListings({ searchToolListings });

  assert.equal(displayed.length, 12);
  assert.equal(displayed[0]?.id, 'tool-0');
  assert.equal(displayed.at(-1)?.id, 'tool-11');
});

test('keeps marketplace exploration visible beside assistant results', () => {
  const marketplaceListings = [{ id: 'api-1' }, { id: 'api-2' }];
  const searchToolListings = [{ id: 'tool-1' }, { id: 'tool-2' }];

  const displayed = getExploreListings({
    marketplaceListings,
    searchToolListings,
  });

  assert.deepEqual(displayed, marketplaceListings);
});

test('deduplicates assistant matches from explore listings when ids overlap', () => {
  const marketplaceListings = [{ id: 'api-1' }, { id: 'api-2' }];
  const searchToolListings = [{ id: 'api-1' }];

  const displayed = getExploreListings({
    marketplaceListings,
    searchToolListings,
  });

  assert.deepEqual(displayed, [{ id: 'api-2' }]);
});

test('allows load-more for marketplace exploration with remaining pages', () => {
  const canLoadMore = getCanLoadMoreExploreListings({
    hasMore: true,
    displayedCount: 6,
  });

  assert.equal(canLoadMore, true);
});

test('home marketplace renders assistant search as a separate active layer', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /hasActiveAssistantSearch/);
  assert.match(homePage, /assistantResultListings\.map/);
  assert.match(homePage, /exploreMarketplaceListings\.map/);
  assert.match(homePage, /نتائج ذكية من مساعد SmartStore AI/);
  assert.doesNotMatch(homePage, /activeListingQuery \|\|/);
  assert.match(homePage, /الأقرب لطلبك/);
  assert.match(homePage, /مختارة حسب طلبك/);
  assert.match(
    homePage,
    /searchToolListings: hasActiveAssistantSearch \? assistantResultListings : \[\]/,
  );
  assert.match(homePage, /clearAssistantSearch/);
  assert.doesNotMatch(homePage, /displayedMarketplaceListings/);
  assert.doesNotMatch(homePage, /refreshMarketplaceListings\(activeListingQuery/);
  assert.doesNotMatch(homePage, /searchResultCount/);
  assert.doesNotMatch(homePage, /نتيجة مطابقة/);
});
