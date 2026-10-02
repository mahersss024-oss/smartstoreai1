import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('manual listing image picker uses the custom upload surface', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const uploadInputIndex = page.indexOf('accept="image/*"', page.indexOf('manualListingForm.description'));
  const uploadSurface = page.slice(uploadInputIndex - 900, uploadInputIndex + 2600);

  assert.match(uploadSurface, /className="sr-only"/);
  assert.match(uploadSurface, /border-2 border-dashed border-blue-400\/70/);
  assert.match(uploadSurface, /<Download className="size-10 stroke-\[2\.4\]"/);
  assert.match(uploadSurface, /إضافة صور الإعلان/);
  assert.match(uploadSurface, /اضغط لاختيار الصور من جهازك/);
  assert.match(uploadSurface, /manualListingImagePreviewUrls\.map/);
  assert.doesNotMatch(
    uploadSurface,
    /className="rounded-md border bg-background px-3 py-2 text-sm"/,
  );
});

test('manual listing button only has transient press feedback', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const buttonIndex = page.indexOf('أنشئ إعلانك يدويًا');
  const buttonSource = page.slice(buttonIndex - 700, buttonIndex + 120);

  assert.match(buttonSource, /active:scale-\[0\.98\]/);
  assert.doesNotMatch(buttonSource, /variant=\{[^}]*isManualListingVisible/);
});
