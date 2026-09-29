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

test('mobile bottom navigation keeps home centered with five compact destinations', () => {
  const navigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');

  assert.match(navigation, /href: '\/account\/listings'/);
  assert.match(navigation, /href: '\/favorites'/);
  assert.match(navigation, /href: '\/account'/);
  assert.match(navigation, /href: '\/'/);
  assert.match(navigation, /href: '\/conversations'/);
  assert.match(navigation, /if \(href === '\/account'\) \{[\s\S]*return pathname === '\/account';[\s\S]*\}/);
  assert.match(navigation, /grid-cols-5/);
  assert.match(navigation, /w-1\/5/);
  assert.match(navigation, /indicatorIndex = activeIndex >= 0 \? activeIndex : 2/);
  assert.match(navigation, /h-11 grid-cols-5 text-\[9px\]/);
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

test('customer section pages keep headers stable while content scrolls', () => {
  const pages = [
    readProjectFile('app', 'account', 'page.tsx'),
    readProjectFile('app', 'account', 'listings', 'page.tsx'),
    readProjectFile('app', 'favorites', 'page.tsx'),
    readProjectFile('app', 'conversations', 'page.tsx'),
  ];
  const styles = readProjectFile('app', 'globals.css');

  for (const page of pages) {
    assert.match(page, /smartstore-stable-page/);
    assert.match(page, /smartstore-stable-content/);
    assert.match(page, /smartstore-stable-header/);
  }

  assert.match(styles, /\.smartstore-stable-page/);
  assert.match(styles, /\.smartstore-stable-header/);
  assert.match(styles, /\.admin-viewport > main/);
  assert.match(styles, /\.marketplace-home-controls/);
  assert.match(styles, /\.marketplace-listings-scroll/);
});

test('customer market pages avoid heavy nested card styling', () => {
  const files = [
    readProjectFile('app', 'account', 'page.tsx'),
    readProjectFile('app', 'account', 'listings', 'page.tsx'),
    readProjectFile('app', 'favorites', 'page.tsx'),
    readProjectFile('app', 'sellers', '[sellerId]', 'page.tsx'),
    readProjectFile('app', 'commissions', 'page.tsx'),
    readProjectFile('app', 'commission-agreement', 'page.tsx'),
    readProjectFile('components', 'legal-policy-page.tsx'),
  ];

  for (const source of files) {
    assert.doesNotMatch(source, /rounded-md border bg-white p-4 shadow-sm/);
    assert.doesNotMatch(source, /rounded-md border bg-white p-5 shadow-sm/);
    assert.doesNotMatch(source, /rounded-md border bg-white p-6 text-center shadow-sm/);
    assert.doesNotMatch(source, /rounded-md border bg-white px-4 py-3 shadow-sm/);
    assert.doesNotMatch(source, /rounded-md border bg-white shadow-sm/);
    assert.doesNotMatch(source, /rounded-md border p-3/);
    assert.doesNotMatch(source, /bg-white p-[45] dark:bg-card/);
    assert.doesNotMatch(source, /bg-white\/80/);
    assert.doesNotMatch(source, /border-b border-white\/70/);
    assert.doesNotMatch(source, /border-b border-white\/40/);
    assert.doesNotMatch(source, /border-t border-white\/50/);
    assert.doesNotMatch(source, /border-t border-border\/70/);
  }
});
