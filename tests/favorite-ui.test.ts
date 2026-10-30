import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

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
  assert.match(actions, /<FloatingActionNotice/);
  assert.match(actions, /open=\{Boolean\(notice\)\}/);
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
