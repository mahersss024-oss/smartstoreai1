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
  assert.match(source, /openLightbox\(selectedImageIndex\)/);
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
  assert.match(source, /className="relative z-10 h-full w-full max-w-6xl select-none object-contain will-change-transform sm:h-auto sm:max-h-\[68dvh\] sm:w-auto sm:max-w-\[min\(88vw,44rem\)\]"[\s\S]*src=\{selectedImage\}/);
  assert.match(source, /className="hidden max-w-\[min\(88vw,44rem\)\] grid-cols-8 gap-2 sm:grid"/);
  assert.match(source, /onClick=\{\(\) => selectLightboxImage\(index\)\}/);
  assert.match(source, /translate3d\(\$\{imagePan\.x\}px, \$\{imagePan\.y\}px, 0\) scale\(\$\{imageZoom\}\)/);
  assert.doesNotMatch(source, /transition-transform duration-150/);
  assert.doesNotMatch(source, /className="max-h-full max-w-full object-contain"[\s\S]*src=\{selectedImage\}/);
  assert.match(source, /className="grid grid-cols-4 gap-1\.5 px-2 pb-2/);
  assert.match(source, /className="h-full w-full object-contain"/);
  assert.match(source, /dark:bg-slate-950/);
  assert.match(source, /aspect-\[16\/9\] w-full overflow-hidden/);
  assert.doesNotMatch(source, /max-h-\[18rem\]/);
  assert.doesNotMatch(source, /grid gap-2 p-2 sm:p-3/);
  assert.doesNotMatch(source, /md:grid-cols-\[minmax\(0,1fr\)_4\.75rem\]/);
});

test('account listing primary image does not stretch with the image manager', async () => {
  const source = await readFile(
    new URL('../app/account/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /md:row-start-1 md:aspect-square md:self-start/,
  );
  assert.doesNotMatch(
    source,
    /md:row-start-1 md:h-full md:min-h-40/,
  );
  assert.match(source, /grid max-w-full grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-2/);
  assert.match(source, /className="h-full w-full object-contain"/);
  assert.doesNotMatch(source, /overflow-x-auto/);
  assert.doesNotMatch(source, /xl:grid xl:grid-cols-2 xl:overflow-visible/);
});
