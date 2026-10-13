import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('listing details keeps all full-width images and opens a full-screen lightbox', async () => {
  const source = await readFile(
    new URL('../app/listings/[listingId]/listing-image-gallery.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /visibleImages = images/);
  assert.doesNotMatch(source, /images\.slice\(0, 8\)/);
  assert.match(source, /shouldShowThumbnails = visibleImages\.length > 1/);
  assert.match(source, /\{shouldShowThumbnails && \(/);
  assert.match(source, /isLightboxOpen/);
  assert.match(source, /openLightbox\(index\)/);
  assert.match(source, /createPortal/);
  assert.match(source, /document\.body/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /className="fixed inset-0 z-\[2147483647\] grid h-dvh w-screen grid-rows-\[auto_1fr_auto\] overscroll-contain bg-black text-white"/);
  assert.match(source, /selectedImageLabel = `\$\{selectedImageIndex \+ 1\} \/ \$\{visibleImages\.length\}`/);
  assert.match(source, /showPreviousImage/);
  assert.match(source, /showNextImage/);
  assert.match(source, /touchStartXRef/);
  assert.match(source, /imageZoom/);
  assert.match(source, /imagePan/);
  assert.match(source, /ImagePan/);
  assert.match(source, /maxImageZoom = 4/);
  assert.match(source, /clampImageZoom/);
  assert.match(source, /getBoundedImagePan/);
  assert.match(source, /clampValue/);
  assert.match(source, /imageViewportRef/);
  assert.match(source, /touchPanStartRef/);
  assert.match(source, /pinchStartDistanceRef/);
  assert.match(source, /pinchStartPanRef/);
  assert.match(source, /mousePanStartRef/);
  assert.match(source, /handleLightboxTouchEnd/);
  assert.match(source, /handleLightboxTouchMove/);
  assert.match(source, /handleLightboxWheel/);
  assert.match(source, /handleLightboxMouseDown/);
  assert.match(source, /handleLightboxMouseMove/);
  assert.match(source, /endMousePan/);
  assert.match(source, /onDoubleClick/);
  assert.match(source, /onMouseDown/);
  assert.match(source, /onMouseMove/);
  assert.match(source, /onMouseUp/);
  assert.match(source, /onTouchStart/);
  assert.match(source, /onTouchMove/);
  assert.match(source, /onTouchEnd/);
  assert.match(source, /onWheel/);
  assert.match(source, /ZoomIn/);
  assert.match(source, /ZoomOut/);
  assert.match(source, /RotateCcw/);
  assert.match(source, /selectLightboxImage/);
  assert.match(source, /absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl/);
  assert.match(source, /absolute inset-0 bg-black\/55/);
  assert.match(source, /absolute left-3 top-1\/2/);
  assert.match(source, /absolute right-3 top-1\/2/);
  assert.match(source, /ref=\{imageViewportRef\}/);
  assert.match(source, /cursor-grab active:cursor-grabbing/);
  assert.match(source, /type ListingGalleryImage = \{/);
  assert.match(source, /originalUrl: string/);
  assert.match(source, /displayUrl: string/);
  assert.match(source, /thumbnailUrl: string/);
  assert.match(source, /src=\{thumbnailUrl\}/);
  assert.match(source, /src=\{displayUrl\}/);
  assert.match(source, /src=\{selectedLightboxUrl\}/);
  assert.match(source, /decoding="async"/);
  assert.match(source, /new Image\(\)/);
  assert.match(source, /image\.src = nextDisplayUrl/);
  assert.match(source, /className="relative z-10 h-full w-full max-w-6xl select-none object-contain will-change-transform sm:h-auto sm:max-h-\[68dvh\] sm:w-auto sm:max-w-\[min\(88vw,44rem\)\]"[\s\S]*src=\{selectedLightboxUrl\}/);
  assert.match(source, /className="hidden max-w-\[min\(88vw,44rem\)\] grid-cols-8 gap-2 sm:grid"/);
  assert.match(source, /onClick=\{\(\) => selectLightboxImage\(index\)\}/);
  assert.match(source, /translate3d\(\$\{imagePan\.x\}px, \$\{imagePan\.y\}px, 0\) scale\(\$\{imageZoom\}\)/);
  assert.doesNotMatch(source, /transition-transform duration-150/);
  assert.doesNotMatch(source, /className="max-h-full max-w-full object-contain"[\s\S]*src=\{selectedImage\}/);
  assert.match(source, /\{visibleImages\.length > 0 && \(/);
  assert.match(source, /className="grid gap-3 px-1 py-2 sm:px-2"/);
  assert.match(source, /aspect-\[4\/3\] w-full overflow-hidden bg-transparent/);
  assert.match(source, /className="h-full w-full object-cover"/);
  assert.doesNotMatch(source, /min-h-\[min\(64dvh,34rem\)\]/);
  assert.doesNotMatch(source, /bg-slate-100 transition/);
  assert.doesNotMatch(source, /className="grid grid-cols-4 gap-1\.5 p-2 sm:p-3"/);
  assert.doesNotMatch(source, /aspect-\[16\/9\] w-full overflow-hidden/);
  assert.doesNotMatch(source, /max-h-\[18rem\]/);
  assert.doesNotMatch(source, /md:grid-cols-\[minmax\(0,1fr\)_4\.75rem\]/);
});

test('listing details passes display, thumbnail, and original image variants to the gallery', async () => {
  const source = await readFile(
    new URL('../app/listings/[listingId]/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /type ListingGalleryImage/);
  assert.match(source, /originalUrl: missingListingImageDataUrl/);
  assert.match(source, /displayUrl: missingListingImageDataUrl/);
  assert.match(source, /thumbnailUrl: missingListingImageDataUrl/);
  assert.match(source, /image\.originalUrl,[\s\S]*image\.displayUrl,[\s\S]*image\.thumbnailUrl/);
  assert.match(source, /image\.displayUrl,[\s\S]*image\.originalUrl,[\s\S]*image\.thumbnailUrl/);
  assert.match(source, /image\.thumbnailUrl,[\s\S]*image\.displayUrl,[\s\S]*image\.originalUrl/);
});

test('R2 orphan image audit is dry-run only', async () => {
  const source = await readFile(
    new URL('../scripts/r2-orphaned-listing-images-dry-run.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /dry-run only/);
  assert.match(source, /SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL/);
  assert.match(source, /Potential orphaned objects/);
  assert.match(source, /not referenced by ListingImage original\/display\/thumbnail URLs/);
  assert.doesNotMatch(source, /method:\s*'DELETE'/);
  assert.doesNotMatch(source, /deleteStoredObject/);
  assert.doesNotMatch(source, /purge_cache/);
});

test('missing listing image repair is dry-run by default and scoped to listing image records', async () => {
  const source = await readFile(
    new URL('../scripts/repair-missing-listing-images.ts', import.meta.url),
    'utf8',
  );
  const packageJson = await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  );

  assert.match(source, /process\.argv\.includes\('--apply'\)/);
  assert.match(source, /Listing image repair running in/);
  assert.match(source, /action: 'delete_record'/);
  assert.match(source, /action: 'repair_urls'/);
  assert.match(source, /prisma\.listingImage\.delete/);
  assert.match(source, /prisma\.listingImage\.update/);
  assert.match(packageJson, /"images:missing:dry-run"/);
  assert.match(packageJson, /"images:missing:apply"/);
  assert.doesNotMatch(source, /deleteMany/);
  assert.doesNotMatch(source, /prisma\.listing\.delete/);
});

test('account listing cards show one primary thumbnail and move the full grid to image management', async () => {
  const source = await readFile(
    new URL('../app/account/listings/page.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /aspect-\[16\/10\] w-full/);
  assert.match(source, /src=\{listing\.image\}/);
  assert.match(source, /const primaryImage =/);
  assert.match(source, /const imageCount = listing\.images\.length/);
  assert.match(source, /formatImageCount\(imageCount\)/);
  assert.match(source, /imageManagerListing\.images\.map\(\(image\) =>/);
  assert.match(source, /previewImageUrl/);
  assert.doesNotMatch(source, /md:row-start-1 md:aspect-square md:self-start/);
  assert.doesNotMatch(
    source,
    /md:row-start-1 md:h-full md:min-h-40/,
  );
  assert.doesNotMatch(source, /grid max-w-full grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8/);
  assert.match(source, /className="h-full w-full object-contain"/);
  assert.doesNotMatch(source, /overflow-x-auto/);
  assert.doesNotMatch(source, /xl:grid xl:grid-cols-2 xl:overflow-visible/);
});

test('customer listing pages avoid large framed containers for scalable lists', async () => {
  const accountListings = await readFile(
    new URL('../app/account/listings/page.tsx', import.meta.url),
    'utf8',
  );
  const listingDetails = await readFile(
    new URL('../app/listings/[listingId]/page.tsx', import.meta.url),
    'utf8',
  );
  const accountPage = await readFile(
    new URL('../app/account/page.tsx', import.meta.url),
    'utf8',
  );
  const followsPage = await readFile(
    new URL('../app/account/follows/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(accountListings, /rounded-md border border-slate-200\/75 bg-white\/88/);
  assert.match(accountListings, /\[contain-intrinsic-size:220px\]/);
  assert.match(accountListings, /dark:border-white\/10 dark:bg-card\/72/);
  assert.match(listingDetails, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(listingDetails, /marketplace-home-controls shrink-0/);
  assert.match(listingDetails, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto/);
  assert.match(accountPage, /marketplace-listings-scroll[\s\S]*?grid[\s\S]*?flex-1[\s\S]*?pb-\[calc\(6\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(followsPage, /items-center gap-3 border-b border-slate-200\/70 p-3/);
  assert.doesNotMatch(accountListings, /rounded-md border bg-white\/60 py-3/);
  assert.doesNotMatch(listingDetails, /rounded-md border bg-white\/60 px-3 py-3/);
  assert.doesNotMatch(accountPage, /rounded-md border bg-white\/60 px-3 py-3/);
});

test('home marketplace prioritizes only initial viewport listing images', async () => {
  const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /prioritizeImage\?: boolean/);
  assert.match(source, /prioritizeImage=\{index < 4\}/);
  assert.match(source, /loading=\{prioritizeImage \? 'eager' : 'lazy'\}/);
  assert.match(source, /fetchPriority=\{prioritizeImage \? 'high' : 'auto'\}/);
  assert.doesNotMatch(source, /loading="eager"/);
});

test('native wrapper and browser request the same first marketplace listings page', async () => {
  const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /params\.set\('limit', '24'\)/);
  assert.doesNotMatch(source, /isNativeApp \? '12' : '24'/);
});

test('home infinite scroll observes the listings scroll container', async () => {
  const [homePage, infiniteScrollHook] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../hooks/use-infinite-scroll.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(infiniteScrollHook, /rootRef\?: RefObject<Element \| null>/);
  assert.match(infiniteScrollHook, /function findNearestScrollRoot\(element: Element\)/);
  assert.match(infiniteScrollHook, /\/\(auto\|scroll\|overlay\)\/\.test\(overflowY\)/);
  assert.match(infiniteScrollHook, /rootRef\?\.current \?\? findNearestScrollRoot\(triggerElement\)/);
  assert.match(infiniteScrollHook, /root: scrollRoot/);
  assert.match(infiniteScrollHook, /const loadMoreDistancePx = 640/);
  assert.match(infiniteScrollHook, /const checkScrollPosition = \(\) => \{/);
  assert.match(infiniteScrollHook, /scrollTarget\.addEventListener\('scroll', checkScrollPosition/);
  assert.match(infiniteScrollHook, /checkScrollPosition\(\)/);
  assert.match(infiniteScrollHook, /requestLoadMore\(\)/);
  assert.match(homePage, /marketplaceListingsScrollRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(homePage, /listingsReplaceRequestIdRef = useRef\(0\)/);
  assert.match(homePage, /listingsAppendRequestIdRef = useRef\(0\)/);
  assert.match(homePage, /listingsAppendRequestIdRef\.current \+= 1/);
  assert.match(homePage, /rootRef: marketplaceListingsScrollRef/);
  assert.match(homePage, /ref=\{marketplaceListingsScrollRef\}/);
  assert.match(homePage, /ref=\{listingsLoadMoreRef\}/);
  assert.match(homePage, /className="h-24 w-full"/);
  assert.doesNotMatch(homePage, /onClick=\{loadMoreListings\}/);
});

test('infinite scroll screens use a stable end sentinel', async () => {
  const pagePaths = [
    '../app/page.tsx',
    '../app/favorites/page.tsx',
    '../app/conversations/page.tsx',
    '../app/commissions/page.tsx',
    '../app/account/listings/page.tsx',
    '../app/admin/users/page.tsx',
    '../app/admin/listings/page.tsx',
    '../app/admin/moderation/page.tsx',
    '../app/admin/commissions/page.tsx',
  ];
  const sources = await Promise.all(
    pagePaths.map((pagePath) =>
      readFile(new URL(pagePath, import.meta.url), 'utf8'),
    ),
  );

  for (const source of sources) {
    assert.match(source, /useInfiniteScroll\(/);
    assert.match(source, /className="h-24 w-full"/);
    assert.doesNotMatch(source, /ref=\{[A-Za-z]+LoadMoreRef\} className="h-px"/);
    assert.doesNotMatch(source, /ref=\{[A-Za-z]+LoadMoreRef\} aria-hidden="true" className="h-4"/);
    assert.doesNotMatch(source, /تحميل المزيد|عرض المزيد/);
  }
});

test('listing cards keep normal navigation while images load', async () => {
  const sources = await Promise.all([
    readFile(new URL('../app/favorites/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/account/follows/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/sellers/[sellerId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/listings/[listingId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  const [
    favoritesPage,
    followsPage,
    sellerPage,
    listingDetailsPage,
    homePage,
    globalCss,
  ] = sources;

  assert.doesNotMatch(favoritesPage, /ListingCardLink|waitForImage|data-image-loading/);
  assert.doesNotMatch(followsPage, /ListingCardLink|waitForImage|data-image-loading/);
  assert.doesNotMatch(sellerPage, /ListingCardLink|waitForImage|data-image-loading/);
  assert.doesNotMatch(listingDetailsPage, /ListingCardLink|waitForImage|data-image-loading/);
  assert.doesNotMatch(homePage, /isCardInteractionDisabled|data-image-loading|markListingImageReady/);
  assert.doesNotMatch(globalCss, /marketplace-card-image-shimmer|marketplace-listing-card\[data-image-loading="true"\]/);
});

test('large repeated customer lists avoid prefetching every dynamic detail route', async () => {
  const sources = await Promise.all([
    readFile(new URL('../app/favorites/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/account/listings/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/account/follows/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/conversations/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/sellers/[sellerId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/listings/[listingId]/page.tsx', import.meta.url), 'utf8'),
  ]);

  for (const source of sources) {
    const linkTags = source.match(/<Link\b[\s\S]*?>/g) ?? [];

    for (const linkTag of linkTags) {
      const isRepeatedDynamicRoute =
        /href=\{(?:`\/(?:listings|conversations)|encodeListingHref|encodeSellerHref|getSellerListingHref|getSimilarListingHref)/.test(
          linkTag,
        );

      if (isRepeatedDynamicRoute) {
        assert.match(linkTag, /prefetch=\{false\}/);
      }
    }
  }
});
