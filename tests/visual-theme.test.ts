import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('light and dark themes share the artistic market surface', () => {
  const css = readProjectFile('app', 'globals.css');
  const home = readProjectFile('app', 'page.tsx');
  const navigation = readProjectFile(
    'components',
    'mobile-bottom-navigation.tsx',
  );

  assert.match(css, /market-surface-light\.svg/);
  assert.match(css, /market-surface-dark\.svg/);
  assert.match(css, /--market-art-surface/);
  assert.match(css, /\.marketplace-primary-cta::after[\s\S]*pointer-events: none/);
  assert.match(css, /\.marketplace-section-title::after[\s\S]*pointer-events: none/);
  assert.match(home, /marketplace-primary-cta/);
  assert.match(home, /marketplace-filter-panel/);
  assert.match(home, /marketplace-listing-card/);
  assert.match(home, /marketplace-section-title/);
  assert.match(navigation, /marketplace-bottom-nav/);
});
