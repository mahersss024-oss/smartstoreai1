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
  assert.match(navigation, /fixed inset-x-1/);
  assert.match(navigation, /overflow-visible/);
  assert.match(navigation, /top-\[calc\(100%\+0\.08rem\)\]/);
  assert.match(navigation, /bg-slate-950\/12 backdrop-blur-\[96px\]/);
  assert.match(navigation, /h-14 grid-cols-5 text-\[13px\]/);
  assert.match(navigation, /bg-white\/32/);
  assert.match(navigation, /backdrop-blur-\[96px\]/);
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
  assert.match(styles, /--marketplace-bottom-nav-space: calc\(5rem \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(styles, /\.smartstore-stable-content,[\s\S]*?align-content: start;/);
  const stablePageBaseRule = styles.slice(
    styles.indexOf('.smartstore-stable-page,'),
    styles.indexOf('@media (pointer: coarse) and (max-width: 1023px)', styles.indexOf('.smartstore-stable-page,')),
  );

  assert.match(stablePageBaseRule, /height: 100dvh;/);
  assert.match(stablePageBaseRule, /max-width: 100%;/);
  assert.match(stablePageBaseRule, /overflow-x: hidden;/);
  assert.match(stablePageBaseRule, /overflow-y: auto;/);
  const stablePageMobileRule = styles.slice(
    styles.indexOf('.smartstore-stable-page,', styles.indexOf('@media (pointer: coarse) and (max-width: 1023px)', styles.indexOf('marketplace-listings-scroll'))),
    styles.indexOf('.admin-viewport > main {', styles.indexOf('marketplace-listings-scroll')),
  );

  assert.doesNotMatch(stablePageMobileRule, /height: 100dvh;/);
  assert.match(styles, /\.admin-viewport > main \{[\s\S]*?height: 100dvh;/);
  assert.match(styles, /body:has\(main\.smartstore-stable-page\)[\s\S]*?padding-bottom: 0 !important;/);
  assert.match(styles, /main\[class\*="bg-\[#e8edf3\]"\]:not\(\.marketplace-shell\):not\(\.customer-conversation-page\)/);
  assert.match(styles, /\.smartstore-stable-page header,[\s\S]*?\.admin-viewport form,[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(styles, /\.smartstore-stable-page \[dir="ltr"\],[\s\S]*?\.admin-viewport \[dir="ltr"\],[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(styles, /@media \(max-width: 1023px\)[\s\S]*?padding-bottom: calc\(1rem \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(styles, /@media \(max-width: 1023px\)[\s\S]*?\.smartstore-stable-content::after,[\s\S]*?height: var\(--marketplace-bottom-nav-space\);/);
  assert.match(styles, /@media \(pointer: coarse\) and \(max-width: 1023px\)[\s\S]*?touch-action: pan-y;/);
});

test('web customer pages keep touchpad scrolling inside the page shell', () => {
  const layout = readProjectFile('app', 'layout.tsx');
  const styles = readProjectFile('app', 'globals.css');
  const customerPages = [
    readProjectFile('app', 'account', 'page.tsx'),
    readProjectFile('app', 'account', 'listings', 'page.tsx'),
    readProjectFile('app', 'favorites', 'page.tsx'),
    readProjectFile('app', 'conversations', 'page.tsx'),
  ];

  assert.match(layout, /<body className="overflow-x-hidden/);
  assert.doesNotMatch(layout, /<body className="[^"]*overflow-hidden/);
  assert.doesNotMatch(styles, /addEventListener\(['"]wheel/);
  assert.doesNotMatch(styles, /mousewheel/);
  assert.match(styles, /body:has\(main\.smartstore-stable-page\)/);
  assert.match(styles, /\.smartstore-stable-page,[\s\S]*?overflow-y: auto;/);

  for (const page of customerPages) {
    assert.match(page, /min-h-screen/);
    assert.doesNotMatch(page, /overflow-hidden bg-\[#e8edf3\]/);
  }
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
