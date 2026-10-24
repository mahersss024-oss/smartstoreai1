import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bottomNavigationDestinations } from '@/lib/navigation/bottom-navigation';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('mobile bottom navigation only links to surviving customer sections', () => {
  const navigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');

  assert.deepEqual(bottomNavigationDestinations.map(item => item.href), ['/conversations', '/favorites', '/notifications', '/commissions']);
  assert.match(navigation, /bottomNavigationDestinations\.map/);
  assert.match(navigation, /grid-cols-4/);
  assert.match(navigation, /w-1\/4/);
  assert.match(navigation, /indicatorIndex = activeIndex >= 0 \? activeIndex : 2/);
  assert.match(navigation, /fixed inset-x-3/);
  assert.match(navigation, /overflow-visible/);
  assert.match(navigation, /rounded-full/);
  assert.match(navigation, /-inset-x-5 top-full h-\[calc\(3rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(navigation, /bg-white\/28 backdrop-blur-\[44px\] backdrop-saturate-\[180%\]/);
  assert.match(navigation, /\[mask-image:linear-gradient\(to_bottom,black_0%,rgba\(0,0,0,0\.88\)_32%,rgba\(0,0,0,0\.48\)_68%,transparent_100%\)\]/);
  assert.match(navigation, /\[-webkit-mask-image:linear-gradient\(to_bottom,black_0%,rgba\(0,0,0,0\.88\)_32%,rgba\(0,0,0,0\.48\)_68%,transparent_100%\)\]/);
  assert.doesNotMatch(navigation, /bg-slate-700\/28/);
  assert.match(navigation, /h-14 grid-cols-4 text-\[13px\]/);
  assert.doesNotMatch(navigation, /action: 'more'/);
  assert.doesNotMatch(navigation, /isMoreOpen/);
  assert.doesNotMatch(navigation, /Grid2X2/);
  assert.match(navigation, /pathname === '\/commission-agreement'/);
});

test('mobile navigation and conversation alert avoid eager cold-load work', () => {
  const navigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');
  const alertHook = readProjectFile('hooks', 'use-conversation-message-alert.ts');

  assert.doesNotMatch(
    navigation,
    /\['\/', '\/account', '\/account\/listings', '\/favorites', '\/conversations'\]\.forEach/,
  );
  assert.doesNotMatch(navigation, /router\.prefetch/);
  assert.doesNotMatch(navigation, /prefetchNavigationTarget/);
  assert.doesNotMatch(navigation, /onPointerEnter/);
  assert.doesNotMatch(navigation, /onTouchStart/);
  assert.match(alertHook, /scheduleIdleTask/);
  assert.match(alertHook, /unreadConversationSyncIdleTimeoutMs/);
  assert.match(alertHook, /unreadConversationSyncMinIntervalMs = 60_000/);
  assert.match(alertHook, /conversationAlertLastSyncStorageKey/);
  assert.doesNotMatch(alertHook, /useSmartstoreRealtime/);
  assert.doesNotMatch(alertHook, /queueMicrotask\(\(\) => \{\s*if \(!cancelled\) \{\s*if \(currentUserId\)/);
});

test('remaining customer pages keep headers stable while content scrolls', () => {
  const conversationsPage = readProjectFile('app', 'conversations', 'page.tsx');
  const favoritesPage = readProjectFile('app', 'favorites', 'page.tsx');
  const styles = readProjectFile('app', 'globals.css');

  assert.match(conversationsPage, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(conversationsPage, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(favoritesPage, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(favoritesPage, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain/);

  assert.match(styles, /\.smartstore-stable-page/);
  assert.match(styles, /\.smartstore-stable-header/);
  assert.match(styles, /\.admin-viewport > main/);
  assert.match(styles, /\.marketplace-home-controls/);
  assert.match(styles, /\.marketplace-listings-scroll/);
  assert.match(styles, /--mobile-web-app-banner-space: 0px;/);
  assert.match(styles, /html\[data-native-app="false"\]\[data-platform="android"\],[\s\S]*?--mobile-web-app-banner-space: 3\.5625rem;/);
  assert.match(styles, /\.open-in-app-banner \{[\s\S]*?height: var\(--mobile-web-app-banner-space\);/);
  assert.match(styles, /--marketplace-bottom-nav-space: calc\(5rem \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(styles, /\.marketplace-bottom-nav \{[\s\S]*?background-color: rgb\(255 255 255 \/ 0\.2\);/);
  assert.match(styles, /-webkit-backdrop-filter: blur\(28px\) saturate\(170%\);/);
  assert.match(styles, /backdrop-filter: blur\(28px\) saturate\(170%\);/);
  assert.match(styles, /@supports not \(\(backdrop-filter: blur\(10px\)\) or \(-webkit-backdrop-filter: blur\(10px\)\)\)/);
  assert.match(styles, /\.smartstore-stable-content,[\s\S]*?align-content: start;/);
  const stablePageBaseRule = styles.slice(
    styles.indexOf('.smartstore-stable-page,'),
    styles.indexOf('@media (pointer: coarse) and (max-width: 1023px)', styles.indexOf('.smartstore-stable-page,')),
  );

  assert.match(stablePageBaseRule, /height: calc\(100dvh - var\(--mobile-web-app-banner-space\)\);/);
  assert.match(stablePageBaseRule, /min-height: calc\(100dvh - var\(--mobile-web-app-banner-space\)\);/);
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
  assert.match(styles, /@media \(max-width: 1023px\)[\s\S]*?padding-bottom: var\(--marketplace-bottom-nav-space\);/);
  assert.doesNotMatch(styles, /\.marketplace-listings-scroll::after/);
  assert.match(readProjectFile('app', 'favorites', 'page.tsx'), /marketplace-listings-scroll[\s\S]*?pb-\[var\(--marketplace-bottom-nav-space\)\]/);
  assert.match(readProjectFile('app', 'conversations', 'page.tsx'), /marketplace-listings-scroll[\s\S]*?pb-\[var\(--marketplace-bottom-nav-space\)\]/);
  assert.doesNotMatch(styles, /\.smartstore-stable-content::after/);
  assert.match(styles, /@media \(pointer: coarse\) and \(max-width: 1023px\)[\s\S]*?touch-action: pan-y;/);
});

test('web customer pages keep touchpad scrolling inside the page shell', () => {
  const layout = readProjectFile('app', 'layout.tsx');
  const styles = readProjectFile('app', 'globals.css');
  const conversationsPage = readProjectFile('app', 'conversations', 'page.tsx');
  const favoritesPage = readProjectFile('app', 'favorites', 'page.tsx');

  assert.match(layout, /<body className="overflow-x-hidden/);
  assert.doesNotMatch(layout, /<body className="[^"]*overflow-hidden/);
  assert.doesNotMatch(styles, /addEventListener\(['"]wheel/);
  assert.doesNotMatch(styles, /mousewheel/);
  assert.match(styles, /body:has\(main\.smartstore-stable-page\)/);
  assert.match(styles, /\.smartstore-stable-page,[\s\S]*?overflow-y: auto;/);

  assert.match(conversationsPage, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(conversationsPage, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(favoritesPage, /marketplace-shell h-dvh min-h-dvh overflow-hidden/);
  assert.match(favoritesPage, /marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});

test('remaining customer pages avoid heavy nested card styling', () => {
  const files = [
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
