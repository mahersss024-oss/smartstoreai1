import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { formatMarketplaceCategory, marketplaceCategoryGroups } from '@/lib/marketplace/categories';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('home marketplace stays independent of Hamad while retaining search, cards and manual creation', () => {
  const homePage = readProjectFile('app', 'page.tsx');
  const listingCardImage = readProjectFile('components', 'listing-card-image.tsx');
  const globalCss = readProjectFile('app', 'globals.css');

  assert.doesNotMatch(homePage, /hasActiveAssistantSearch|retainedSearchToolOutput|visibleSearchToolOutput|assistantResultListings/);
  assert.match(homePage, /exploreMarketplaceListings\.map/);
  assert.doesNotMatch(homePage, /نتائج حمد حسب طلبك/);
  assert.doesNotMatch(homePage, /activeListingQuery \|\|/);
  assert.doesNotMatch(homePage, /الأقرب لطلبك/);
  assert.doesNotMatch(homePage, /مختارة حسب طلبك/);
  assert.doesNotMatch(homePage, /clearAssistantSearch/);
  assert.doesNotMatch(homePage, /displayedMarketplaceListings/);
  assert.doesNotMatch(homePage, /refreshMarketplaceListings\(activeListingQuery/);
  assert.doesNotMatch(homePage, /searchResultCount/);
  assert.doesNotMatch(homePage, /نتيجة مطابقة/);
  assert.doesNotMatch(homePage, /smart-assistant-results-panel|smart-assistant-result-card|isSmartResult/);
  assert.match(homePage, /maxChatListingCardsPerMessage = 3/);
  assert.match(homePage, /omittedListingCardCount > 0/);
  assert.match(homePage, /moreChatListingsGuidance/);
  assert.match(homePage, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(homePage, /marketplace-home-controls shrink-0/);
  assert.match(homePage, /isManualListingVisible[\s\S]*max-h-\[min\(58dvh,34rem\)\]/);
  assert.match(homePage, /popoverClassName="z-\[80\]"/);
  assert.match(homePage, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto/);
  assert.match(homePage, /pb-\[var\(--marketplace-bottom-nav-space\)\]/);
  assert.match(homePage, /animationDelay/);
  assert.match(homePage, /marketplaceCategoryGroups/);
  assert.match(homePage, /marketplaceCategoryGroups[^\n]*from '@\/lib\/marketplace\/categories'/);
  const supplies = marketplaceCategoryGroups.find(group => group.label === 'أزياء ومستلزمات');
  assert.ok(supplies?.categories.includes('مستلزمات نسائية'));
  assert.ok(supplies?.categories.includes('مستلزمات رجالية'));
  assert.equal(formatMarketplaceCategory('women_supplies'), 'مستلزمات نسائية');
  assert.equal(formatMarketplaceCategory('men_supplies'), 'مستلزمات رجالية');
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
    assert.match(homePage, /prepareUploadableImageFilesOnDemand\(selectedImages\)/);
    assert.match(
      homePage,
      /'جاري تجهيز ' \+ manualListingImages\.length \+ ' صور للرفع\.\.\.'/,
    );
    assert.doesNotMatch(homePage, /formData\.append\('thumbnailImage'/);
    assert.doesNotMatch(homePage, /formData\.append\('displayImage'/);
  assert.match(homePage, /variant\?: 'grid' \| 'horizontal'/);
  assert.match(homePage, /variant="horizontal"/);
  assert.doesNotMatch(homePage, /askToCompareListing|مقارنة الإعلان/);
  assert.doesNotMatch(homePage, /absolute left-9 top-1\.5/);
  assert.doesNotMatch(homePage, /absolute right-1\.5 top-1\.5 size-7/);
  assert.doesNotMatch(homePage, /aria-label="حفظ الإعلان"/);
  assert.match(homePage, /relative aspect-square min-h-\[6\.25rem\] bg-slate-100/);
  assert.match(homePage, /grid-cols-\[6\.25rem_minmax\(0,1fr\)\]/);
  assert.match(homePage, /object-cover/);
  assert.match(homePage, /formatListingRelativeTime/);
  assert.match(homePage, /formatListingRelativeTime\(listing\.createdAt \?\? listing\.updatedAt\)/);
  assert.match(homePage, /<ListingCardImage/);
  assert.match(listingCardImage, /loading=\{priority \|\| eager \? 'eager' : 'lazy'\}/);
  assert.match(listingCardImage, /decoding="async"/);
  assert.match(homePage, /min-h-\[6\.25rem\] w-full/);
  assert.match(homePage, /sm:min-h-\[7\.25rem\]/);
  assert.doesNotMatch(homePage, /\[contain-intrinsic-size:126px\]/);
  assert.doesNotMatch(homePage, /isCardInteractionDisabled/);
  assert.doesNotMatch(homePage, /data-image-loading/);
  assert.doesNotMatch(homePage, /markListingImageReady/);
  assert.doesNotMatch(globalCss, /marketplace-listing-card\[data-image-loading="true"\]/);
  assert.doesNotMatch(globalCss, /marketplace-card-image-shimmer/);
  assert.doesNotMatch(globalCss, /smart-assistant-results-panel|smart-assistant-result-card/);
  assert.match(globalCss, /prefers-reduced-motion: reduce/);
});

test('home auxiliary links avoid route prefetch during normal browsing', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  for (const href of ['/terms', '/account']) {
    assert.match(
      homePage,
      new RegExp(`href="${href.replace(/\//g, '\\/')}"[\\s\\S]{0,80}prefetch=\\{false\\}`),
    );
  }

  assert.match(homePage, /الشروط والسياسات/);
  assert.doesNotMatch(homePage, /href="\/listing-policy"[\s\S]{0,80}prefetch=\{false\}/);
  assert.doesNotMatch(homePage, /href="\/commission-policy"[\s\S]{0,80}prefetch=\{false\}/);
});

test('city selection supports search after opening everywhere it is used', () => {
  const selector = readProjectFile('components', 'city-selector.tsx');
  const accountListings = readProjectFile('app', 'account', 'listings', 'page.tsx');
  const adminListings = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(selector, /\{isOpen \? createPortal\(/);
  assert.match(selector, /popoverRef\.current\?\.contains/);
  assert.match(selector, /document\.body/);
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
  assert.match(globalCss, /body > main,\s*body > \.page-transition-content > main \{[^}]*overflow-x: hidden;[^}]*overflow-x: clip;/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\]/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\][\s\S]*width:\s*100dvw;/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\] body > main/);
  assert.match(globalCss, /html\[data-native-app="true"\]\[data-platform="android"\] body > \.page-transition-content > main/);
  assert.match(globalCss, /--native-status-bar-inset: env\(safe-area-inset-top, 0px\);/);
  assert.doesNotMatch(globalCss, /max\(env\(safe-area-inset-top, 0px\), 28px\)/);
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
  assert.match(listingGallery, /className="grid gap-3 px-1 py-2 sm:px-2"/);
  assert.match(listingGallery, /aspect-\[4\/3\] w-full overflow-hidden bg-transparent/);
  assert.match(listingGallery, /onClick=\{\(\) => openLightbox\(index\)\}/);
});

test('public marketplace API wires the shared exact ID lookup into its active search path', () => {
  const repository = readProjectFile('agent', 'marketplace', 'repository.ts');
  const store = readProjectFile('agent', 'marketplace', 'store.ts');
  const route = readProjectFile('app', 'api', 'marketplace', 'listings', 'route.ts');
  const search = readProjectFile('lib', 'marketplace', 'title-search.ts');

  assert.match(repository, /publicListingFiltersSql\(filters\)/);
  assert.match(search, /export function getMarketplaceListingIdLookup/);
  assert.match(search, /Prisma\.sql`"id" = \$\{listingId\}`/);
  assert.match(store, /listing\.id === listingId/);
  assert.match(route, /await listPublicMarketplaceListings\(/);
  assert.match(route, /const query = url\.searchParams\.get\('q'\)/);
});

test('public listings api avoids stale pagination cache for infinite scroll', () => {
  const route = readProjectFile('app', 'api', 'marketplace', 'listings', 'route.ts');

  assert.match(route, /noStoreHeaders/);
  assert.doesNotMatch(route, /getOrSetPublicJsonCache/);
  assert.doesNotMatch(route, /createPublicCacheHeaders/);
});
