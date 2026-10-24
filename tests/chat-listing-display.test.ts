import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}test('city selection supports search in administration', () => {
  const selector = readProjectFile('components', 'city-selector.tsx');
  const adminListings = readProjectFile('app', 'admin', 'listings', 'page.tsx');
  assert.match(selector, /document\.body/);
  assert.match(selector, /normalizeArabicSearch/);
  assert.match(selector, /saudiMarketplaceCities/);
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
});test('touch and image controls remain interactive in administration and listing details', () => {
  const globalCss = readProjectFile('app', 'globals.css');
  const adminListingsPage = readProjectFile('app', 'admin', 'listings', 'page.tsx');
  const listingGallery = readProjectFile('app', 'listings', '[listingId]', 'listing-image-gallery.tsx');
  const htmlRule = globalCss.match(/\n\s*html \{[^}]*\}/)?.[0] ?? '';
  const bodyRule = globalCss.match(/\n\s*body \{[^}]*\}/)?.[0] ?? '';
  assert.doesNotMatch(htmlRule, /touch-action:/);
  assert.doesNotMatch(bodyRule, /touch-action:/);
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
