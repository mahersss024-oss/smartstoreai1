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
  const globalCss = readProjectFile('app', 'globals.css');

  assert.match(homePage, /hasActiveAssistantSearch/);
  assert.match(homePage, /retainedSearchToolOutput/);
  assert.match(homePage, /visibleSearchToolOutput/);
  assert.match(homePage, /afterLatestUserOnly: false/);
  assert.doesNotMatch(homePage, /setRetainedSearchToolOutput/);
  assert.match(homePage, /assistantResultListings\.map/);
  assert.match(homePage, /exploreMarketplaceListings\.map/);
  assert.match(homePage, /نتائج ذكية من حمد/);
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
  assert.match(homePage, /smart-assistant-results-panel/);
  assert.match(homePage, /smart-assistant-result-card/);
  assert.match(homePage, /animationDelay/);
  assert.match(homePage, /marketplaceCategoryGroups/);
  assert.match(homePage, /saudiMarketplaceCities/);
  assert.match(homePage, /marketplaceSearchInput/);
  assert.match(homePage, /marketplaceSearchQuery/);
  assert.match(homePage, /params\.set\('q', effectiveQuery\.trim\(\)\)/);
  assert.match(homePage, /placeholder="ابحث في كل السوق"/);
  assert.match(homePage, /DropdownMenuRadioGroup/);
  assert.match(homePage, /DropdownMenuRadioItem value="all"/);
  assert.match(homePage, /selectedMarketSubcategory/);
  assert.match(homePage, /manuallyFilteredMarketplaceListings/);
  assert.match(homePage, /isManualListingVisible/);
  assert.match(homePage, /submitManualListing/);
  assert.match(homePage, /fetch\('\/api\/marketplace\/listings'/);
  assert.match(homePage, /manualListingForm\.priceMode === 'negotiable'/);
  assert.match(homePage, /saleTerms: 'negotiable'/);
  assert.match(homePage, /disabled=\{manualListingForm\.priceMode === 'bid'\}/);
  assert.match(homePage, /تم حفظ الإعلان في حسابي كمسودة/);
  assert.match(homePage, /نشره من صفحة حسابي/);
  assert.match(homePage, /!isManualListingVisible && manualListingNotice/);
  assert.match(homePage, /manual-listing-image-upload/);
  assert.match(homePage, /typeof crypto\.randomUUID === 'function'/);
  assert.match(homePage, /crypto\.getRandomValues\(bytes\)/);
  assert.match(homePage, /formData\.append\('image', await createUploadableImageFile\(image\)\)/);
  assert.match(homePage, /variant\?: 'grid' \| 'horizontal'/);
  assert.match(homePage, /variant="horizontal"/);
  assert.match(globalCss, /smart-assistant-results-panel-in/);
  assert.match(globalCss, /smart-assistant-result-card-in/);
  assert.match(globalCss, /prefers-reduced-motion: reduce/);
});

test('prevents page-level horizontal panning on all viewports', () => {
  const globalCss = readProjectFile('app', 'globals.css');

  assert.match(globalCss, /html \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;/);
  assert.match(globalCss, /body \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;/);
  assert.match(globalCss, /body > main \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;/);
  assert.match(globalCss, /overscroll-behavior-x: none;/);
});

test('keeps intentional touch controls and image strips interactive', () => {
  const globalCss = readProjectFile('app', 'globals.css');
  const homePage = readProjectFile('app', 'page.tsx');
  const adminListingsPage = readProjectFile('app', 'admin', 'listings', 'page.tsx');
  const listingGallery = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'listing-image-gallery.tsx',
  );
  const htmlRule = globalCss.match(/\n\s*html \{[^}]*\}/)?.[0] ?? '';
  const bodyRule = globalCss.match(/\n\s*body \{[^}]*\}/)?.[0] ?? '';

  assert.doesNotMatch(htmlRule, /touch-action:/);
  assert.doesNotMatch(bodyRule, /touch-action:/);
  assert.match(globalCss, /\.smartstore-ai-bubble \{[\s\S]*touch-action: none;/);
  assert.match(homePage, /setPointerCapture\(event\.pointerId\)/);
  assert.match(homePage, /releasePointerCapture\(event\.pointerId\)/);
  assert.match(adminListingsPage, /overflow-x-auto/);
  assert.match(listingGallery, /grid-cols-4/);
  assert.match(listingGallery, /onClick=\{\(\) => setSelectedImage\(image\)\}/);
});
