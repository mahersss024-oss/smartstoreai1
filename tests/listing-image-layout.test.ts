import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('listing details keeps up to eight thumbnails in a four-column grid below the main image', async () => {
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
  assert.match(source, /aria-label="عارض صور الإعلان"/);
  assert.match(source, /className="fixed inset-0 z-50 grid grid-rows-\[auto_1fr_auto\] bg-black text-white"/);
  assert.match(source, /selectedImageLabel = `\$\{selectedImageIndex \+ 1\} \/ \$\{visibleImages\.length\}`/);
  assert.match(source, /showPreviousImage/);
  assert.match(source, /showNextImage/);
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
