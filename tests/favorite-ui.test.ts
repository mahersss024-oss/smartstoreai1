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
  assert.match(actions, /session\.user\?\.id !== sellerId/);
  assert.match(actions, /setIsFavorite\(payload\.status !== 'removed'\)/);
  assert.match(actions, /aria-pressed=\{isFavorite\}/);
  assert.match(actions, /fill-current/);
});
