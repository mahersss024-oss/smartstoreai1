import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('listing details keeps up to eight thumbnails and opens a full-screen lightbox', async () => {
  const source = await readFile(
    new URL('../app/listings/[listingId]/listing-image-gallery.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /visibleImages = images\.slice\(0, 8\)/);
  assert.match(source, /shouldShowThumbnails = visibleImages\.length > 1/);
  assert.match(source, /\{shouldShowThumbnails && \(/);
  assert.match(source, /isLightboxOpen/);
  assert.match(source, /openLightbox\(index\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /className="fixed inset-0 z-\[10000\] grid grid-rows-\[auto_1fr_auto\] bg-black text-white"/);
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
  assert.match(source, /src=\{selectedOriginalUrl\}/);
  assert.match(source, /decoding="async"/);
  assert.match(source, /new Image\(\)/);
  assert.match(source, /image\.src = nextDisplayUrl/);
  assert.match(source, /className="relative z-10 h-full w-full max-w-6xl select-none object-contain will-change-transform sm:h-auto sm:max-h-\[68dvh\] sm:w-auto sm:max-w-\[min\(88vw,44rem\)\]"[\s\S]*src=\{selectedOriginalUrl\}/);
  assert.match(source, /className="hidden max-w-\[min\(88vw,44rem\)\] grid-cols-8 gap-2 sm:grid"/);
  assert.match(source, /onClick=\{\(\) => selectLightboxImage\(index\)\}/);
  assert.match(source, /translate3d\(\$\{imagePan\.x\}px, \$\{imagePan\.y\}px, 0\) scale\(\$\{imageZoom\}\)/);
  assert.doesNotMatch(source, /transition-transform duration-150/);
  assert.doesNotMatch(source, /className="max-h-full max-w-full object-contain"[\s\S]*src=\{selectedImage\}/);
  assert.match(source, /\{visibleImages\.length > 0 && \(/);
  assert.match(source, /className="grid grid-cols-4 gap-1\.5 p-2 sm:p-3"/);
  assert.match(source, /className="h-full w-full object-contain"/);
  assert.match(source, /bg-slate-100 transition/);
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

test('account listing image manager uses thumbnails without a large preview', async () => {
  const source = await readFile(
    new URL('../app/account/listings/page.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /aspect-\[16\/10\] w-full/);
  assert.doesNotMatch(source, /src=\{listing\.image\}/);
  assert.doesNotMatch(source, /md:row-start-1 md:aspect-square md:self-start/);
  assert.doesNotMatch(
    source,
    /md:row-start-1 md:h-full md:min-h-40/,
  );
  assert.match(source, /grid max-w-full grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8/);
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

  assert.match(accountListings, /border-b border-slate-200\/70 py-3/);
  assert.match(accountListings, /last:border-b-0 dark:border-white\/10/);
  assert.match(listingDetails, /grid items-start gap-4 px-1 py-3/);
  assert.match(accountPage, /grid gap-2 px-1 py-3 sm:px-2/);
  assert.match(followsPage, /items-center gap-3 border-b border-slate-200\/70 p-3/);
  assert.doesNotMatch(accountListings, /rounded-md border bg-white\/60 py-3/);
  assert.doesNotMatch(listingDetails, /rounded-md border bg-white\/60 px-3 py-3/);
  assert.doesNotMatch(accountPage, /rounded-md border bg-white\/60 px-3 py-3/);
});
