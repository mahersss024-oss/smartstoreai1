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

test('administration previews keep approved display variants and the existing gallery', async () => {
  const preview = await readFile(new URL('../components/admin/customer-record-preview.tsx', import.meta.url), 'utf8');
  assert.match(preview, /image.status === 'approved'/);
  assert.match(preview, /ListingImageGallery/);
  assert.match(preview, /displayUrl/);
  assert.match(preview, /thumbnailUrl/);
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
});test('listing details keep a compact scrolling layout', async () => {
  const listingDetails = await readFile(new URL('../app/listings/[listingId]/page.tsx', import.meta.url), 'utf8');
  assert.match(listingDetails, /CustomerAppGateway/);
  assert.match(listingDetails, /hasVerifiedModeratorAccess/);
  assert.match(listingDetails, /AdminListingPreview/);
  assert.doesNotMatch(listingDetails, /rounded-md border bg-white\/60 px-3 py-3/);
});test('remaining infinite-scroll screens use a stable end sentinel', async () => {
  const pagePaths = [
    '../app/admin/users/page.tsx',
    '../app/admin/listings/page.tsx',
    '../app/admin/moderation/page.tsx',
    '../app/admin/commissions/page.tsx',
  ];
  const sources = await Promise.all(pagePaths.map((pagePath) => readFile(new URL(pagePath, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.match(source, /useInfiniteScroll\(/);
    assert.match(source, /className="h-24 w-full"/);
    assert.doesNotMatch(source, /ref=\{[A-Za-z]+LoadMoreRef\} className="h-px"/);
    assert.doesNotMatch(source, /ref=\{[A-Za-z]+LoadMoreRef\} aria-hidden="true" className="h-4"/);
  }
});test('listing cards keep normal navigation while images load', async () => {
  const sources = await Promise.all([
    readFile(new URL('../app/favorites/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/sellers/[sellerId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/listings/[listingId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  for (const source of sources.slice(0, 3)) assert.doesNotMatch(source, /ListingCardLink|waitForImage|data-image-loading/);
  assert.doesNotMatch(sources[3], /marketplace-card-image-shimmer|marketplace-listing-card\[data-image-loading="true"\]/);
});test('remaining customer lists avoid eager dynamic detail links', async () => {
  const sources = await Promise.all([
    readFile(new URL('../app/favorites/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/conversations/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/sellers/[sellerId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/listings/[listingId]/page.tsx', import.meta.url), 'utf8'),
  ]);
  for (const source of sources) assert.match(source, /CustomerAppGateway/, 'customer browser routes are app gateways rather than prefetching old detail UIs');
});
