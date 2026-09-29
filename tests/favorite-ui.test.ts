import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('home listing cards render saved favorites as filled blue hearts', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /favoriteListingIds/);
  assert.match(homePage, /isFavorite=\{Boolean/);
  assert.match(homePage, /sellerId\?: string/);
  assert.match(homePage, /isOwnListing=\{Boolean/);
  assert.match(homePage, /!\s*isOwnListing &&/);
  assert.match(homePage, /aria-pressed=\{isFavorite\}/);
  assert.match(homePage, /fill-current/);
  assert.match(homePage, /\/api\/marketplace\/me\/favorites\?page=1&limit=48/);
});

test('listing details favorite action fills the heart after saving', () => {
  const actions = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'listing-safety-actions.tsx',
  );

  assert.match(actions, /isFavorite/);
  assert.match(actions, /sellerId: string/);
  assert.match(actions, /canFavorite/);
  assert.match(actions, /session\.user\.id === sellerId/);
  assert.match(actions, /\/api\/marketplace\/listings\/\$\{listingId\}\/favorite/);
  assert.match(actions, /setIsFavorite\(Boolean\(favoriteState\.isFavorite\)\)/);
  assert.match(actions, /setIsFavorite\(payload\.status !== 'removed'\)/);
  assert.match(actions, /aria-pressed=\{isFavorite\}/);
  assert.match(actions, /fill-current/);
});

test('listing favorite api exposes exact favorite state for detail pages', () => {
  const favoriteRoute = readProjectFile(
    'app',
    'api',
    'marketplace',
    'listings',
    '[listingId]',
    'favorite',
    'route.ts',
  );

  assert.match(favoriteRoute, /export async function GET/);
  assert.match(favoriteRoute, /getListingFavoriteState/);
  assert.match(favoriteRoute, /favorite_state/);
  assert.match(favoriteRoute, /isFavorite: result\.isFavorite/);
  assert.match(favoriteRoute, /canFavorite: result\.canFavorite/);
});

test('favorites page renders saved listings as compact horizontal rows', () => {
  const favoritesPage = readProjectFile('app', 'favorites', 'page.tsx');

  assert.match(favoritesPage, /<section className="px-1 py-3 sm:px-2">/);
  assert.match(favoritesPage, /grid w-full grid-cols-\[6\.25rem_minmax\(0,1fr\)\]/);
  assert.match(favoritesPage, /grid-cols-\[6\.25rem_minmax\(0,1fr\)\]/);
  assert.match(favoritesPage, /sm:grid-cols-\[7\.25rem_minmax\(0,1fr\)\]/);
  assert.match(favoritesPage, /className="line-clamp-2 text-\[13px\] font-bold/);
  assert.match(favoritesPage, /formatListingRelativeTime/);
  assert.match(favoritesPage, /favorite\.listing\?\.createdAt \?\?\s*favorite\.listing\?\.updatedAt/);
  assert.match(favoritesPage, /Clock3/);
  assert.match(favoritesPage, /object-cover/);
  assert.doesNotMatch(favoritesPage, /sm:grid-cols-2 lg:grid-cols-3/);
  assert.doesNotMatch(favoritesPage, /object-contain/);
});
