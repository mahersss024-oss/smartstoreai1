import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('home marketplace toolbar keeps behavior while simplifying labels', () => {
  const page = readProjectFile('app', 'page.tsx');

  assert.doesNotMatch(page, /واجهة الإعلانات/);
  assert.match(page, /onClick=\{handleNearbyMarketplaceSearch\}/);
  assert.match(page, /setIsMarketFilterOpen\(\(value\) => !value\)/);
  assert.match(page, /موقعي/);
  assert.match(page, /تصفية البحث/);
});

test('mobile bottom navigation has account home and conversations only', () => {
  const navigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');

  assert.match(navigation, /href: '\/account'/);
  assert.match(navigation, /href: '\/'/);
  assert.match(navigation, /href: '\/conversations'/);
  assert.match(navigation, /grid-cols-3/);
  assert.match(navigation, /w-1\/3/);
  assert.doesNotMatch(navigation, /action: 'more'/);
  assert.doesNotMatch(navigation, /isMoreOpen/);
  assert.doesNotMatch(navigation, /Grid2X2/);
});

test('account page exposes former more links without changing routes', () => {
  const page = readProjectFile('app', 'account', 'page.tsx');

  assert.match(page, /الخدمات والإعدادات/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/listing-policy"/);
  assert.match(page, /href="\/commission-policy"/);
});
