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
