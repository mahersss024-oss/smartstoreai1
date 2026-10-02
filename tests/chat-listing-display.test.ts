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
  assert.match(homePage, /نتائج حمد حسب طلبك/);
  assert.doesNotMatch(homePage, /activeListingQuery \|\|/);
  assert.doesNotMatch(homePage, /الأقرب لطلبك/);
  assert.doesNotMatch(homePage, /مختارة حسب طلبك/);
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
  assert.match(homePage, /isSmartResult\?: boolean/);
  assert.match(homePage, /isSmartResult &&/);
  assert.match(homePage, /maxChatListingCardsPerMessage = 3/);
  assert.match(homePage, /omittedListingCardCount > 0/);
  assert.match(homePage, /moreChatListingsGuidance/);
  assert.match(homePage, /smart-assistant-results-grid grid max-w-4xl gap-1\.5 sm:gap-2/);
  assert.match(homePage, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(homePage, /marketplace-home-controls shrink-0/);
  assert.match(homePage, /isManualListingVisible[\s\S]*max-h-\[min\(58dvh,34rem\)\]/);
  assert.match(homePage, /popoverClassName="z-\[80\]"/);
  assert.match(homePage, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto/);
  assert.match(homePage, /pb-\[var\(--marketplace-bottom-nav-space\)\]/);
  assert.match(homePage, /animationDelay/);
  assert.match(homePage, /marketplaceCategoryGroups/);
  assert.match(homePage, /label: 'أزياء ومستلزمات'/);
  assert.match(homePage, /'مستلزمات نسائية'/);
  assert.match(homePage, /'مستلزمات رجالية'/);
  assert.match(homePage, /women_supplies: 'مستلزمات نسائية'/);
  assert.match(homePage, /men_supplies: 'مستلزمات رجالية'/);
  assert.match(homePage, /saudiMarketplaceCities/);
  assert.match(homePage, /marketplaceSearchInput/);
  assert.match(homePage, /marketplaceSearchQuery/);
  assert.match(homePage, /params\.set\('q', effectiveQuery\.trim\(\)\)/);
  assert.match(homePage, /placeholder="ابحث في كل السوق"/);
  assert.match(homePage, /<CitySelector/);
  assert.match(homePage, /allValue="all"/);
  assert.match(homePage, /selectedMarketSubcategory/);
  assert.match(homePage, /manuallyFilteredMarketplaceListings/);
  assert.match(homePage, /isManualListingVisible/);
  assert.match(homePage, /submitManualListing/);
  assert.match(homePage, /setManualListingNotice\(null\)/);
  assert.doesNotMatch(homePage, /أدخل بيانات الإعلان مباشرة/);
  assert.match(homePage, /fetch\('\/api\/marketplace\/listings'/);
  assert.match(homePage, /publishAfterSave/);
  assert.match(homePage, /isManualPublishAgreementOpen/);
  assert.match(homePage, /confirmManualPublishAgreement/);
  assert.match(homePage, /mode="publish"/);
  assert.match(homePage, /manual-listing-publish/);
  assert.match(homePage, /JSON\.stringify\(\{ action: 'publish' \}\)/);
  assert.match(homePage, /حفظ ونشر الإعلان/);
  assert.match(homePage, /تم نشر الإعلان بنجاح/);
  assert.match(homePage, /manualListingForm\.priceMode === 'negotiable'/);
  assert.match(homePage, /saleTerms: 'negotiable'/);
  assert.match(homePage, /disabled=\{manualListingForm\.priceMode === 'bid'\}/);
  assert.match(homePage, /تم حفظ الإعلان/);
  assert.match(homePage, /إذا أردت نشره، انتقل إلى حسابي ← إعلاناتي ثم اختر نشر الإعلان/);
  assert.match(homePage, /<FloatingActionNotice/);
  assert.match(homePage, /open=\{Boolean\(manualListingNotice\)\}/);
  assert.match(homePage, /إغلاق نتيجة إنشاء الإعلان/);
  assert.match(homePage, /ListingShareButton/);
  assert.doesNotMatch(homePage, /الذهاب إلى حسابي للنشر/);
  assert.match(homePage, /manual-listing-image-upload/);
  assert.match(homePage, /typeof crypto\.randomUUID === 'function'/);
  assert.match(homePage, /crypto\.getRandomValues\(bytes\)/);
    assert.match(homePage, /prepareUploadableImageFiles\(selectedImages\)/);
    assert.match(
      homePage,
      /'جاري تجهيز ' \+ manualListingImages\.length \+ ' صور للرفع\.\.\.'/,
    );
    assert.doesNotMatch(homePage, /formData\.append\('thumbnailImage'/);
    assert.doesNotMatch(homePage, /formData\.append\('displayImage'/);
  assert.match(homePage, /variant\?: 'grid' \| 'horizontal'/);
  assert.match(homePage, /variant="horizontal"/);
  assert.match(
    homePage,
    /assistantResultListings\.map[\s\S]*className="smart-assistant-result-card"[\s\S]*isSmartResult[\s\S]*variant="horizontal"/,
  );
  assert.match(homePage, /const askToCompareListing = \(\) => \{/);
  assert.match(homePage, /absolute left-1\.5 top-1\.5 z-10 size-7/);
  assert.match(homePage, /shadow-cyan-400\/35/);
  assert.match(homePage, /drop-shadow-\[0_0_6px_rgba\(34,211,238,0\.85\)\]/);
  assert.doesNotMatch(homePage, /absolute left-9 top-1\.5/);
  assert.match(homePage, /absolute right-1\.5 top-1\.5 size-7/);
  assert.match(homePage, /askToCompareListing\(\);/);
  assert.match(homePage, /relative aspect-square min-h-\[6\.25rem\] bg-slate-100/);
  assert.match(homePage, /grid-cols-\[6\.25rem_minmax\(0,1fr\)\]/);
  assert.match(homePage, /object-cover/);
  assert.match(homePage, /formatListingRelativeTime/);
  assert.match(homePage, /formatListingRelativeTime\(listing\.createdAt \?\? listing\.updatedAt\)/);
  assert.match(homePage, /loading="lazy"/);
  assert.match(homePage, /decoding="async"/);
  assert.match(homePage, /\[content-visibility:auto\]/);
  assert.match(homePage, /\[contain-intrinsic-size:126px\]/);
  assert.match(globalCss, /smart-assistant-results-panel-in/);
  assert.match(globalCss, /smart-assistant-result-card-in/);
  assert.match(globalCss, /prefers-reduced-motion: reduce/);
});

test('city selection supports search after opening everywhere it is used', () => {
  const selector = readProjectFile('components', 'city-selector.tsx');
  const accountListings = readProjectFile('app', 'account', 'listings', 'page.tsx');
  const adminListings = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(selector, /\{isOpen \? \(/);
  assert.match(selector, /placeholder="ابحث عن مدينة"/);
  assert.match(selector, /max-h-64 overflow-y-auto/);
  assert.match(selector, /normalizeArabicSearch/);
  assert.match(selector, /saudiMarketplaceCities/);
  assert.match(selector, /focus\(\{ preventScroll: true \}\)/);
  assert.match(selector, /matchMedia\('\(pointer: fine\)'\)/);
  assert.match(selector, /\[contain:layout_paint\]/);
  assert.match(accountListings, /<CitySelector/);
  assert.match(adminListings, /<CitySelector/);
});

test('prevents page-level horizontal panning on all viewports', () => {
  const globalCss = readProjectFile('app', 'globals.css');

  assert.match(globalCss, /html \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;/);
  assert.match(globalCss, /body \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;/);
  assert.match(globalCss, /body > main \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\]/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\][\s\S]*width:\s*100dvw;/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\] body > main/);
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
  assert.ok(homePage.includes('/hamad-assistant-bubble.webp?v=ask-hamad-20260927'));
  assert.doesNotMatch(homePage, /smartstore-ai-bubble__label/);
  assert.doesNotMatch(globalCss, /smartstore-ai-bubble__label/);
  assert.match(homePage, /اسأل/);
  assert.match(homePage, /حمد/);
  assert.match(homePage, /setPointerCapture\(event\.pointerId\)/);
  assert.match(homePage, /releasePointerCapture\(event\.pointerId\)/);
  assert.match(adminListingsPage, /overflow-x-auto/);
  assert.match(listingGallery, /grid-cols-4/);
  assert.match(listingGallery, /onClick=\{\(\) => openLightbox\(index\)\}/);
});

test('public marketplace search supports listing id and listing links safely', () => {
  const repository = readProjectFile('agent', 'marketplace', 'repository.ts');
  const store = readProjectFile('agent', 'marketplace', 'store.ts');
  const route = readProjectFile('app', 'api', 'marketplace', 'listings', 'route.ts');

  assert.match(repository, /function extractListingIdLookup/);
  assert.match(repository, /listingPathMatch/);
  assert.match(repository, /id: \{ contains: listingIdLookup, mode: 'insensitive' \}/);
  assert.match(repository, /status: 'published'/);
  assert.match(store, /function extractListingIdLookup/);
  assert.match(store, /listing\.id\.toLowerCase\(\)\.includes/);
  assert.match(route, /const query = url\.searchParams\.get\('q'\)/);
});
