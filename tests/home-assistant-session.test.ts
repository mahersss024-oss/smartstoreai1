import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('home assistant starts clean without durable chat history', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /resetAssistantSearchState/);
  assert.match(homePage, /resetSearchState/);
  assert.match(homePage, /shouldResetSearchStateRef\.current = true/);
  assert.doesNotMatch(
    homePage,
    /localStorage\.setItem\(\s*currentChatStorageKey/,
  );
});

test('home assistant keeps chat only across in-app navigation', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /type HomeAssistantRuntimeState/);
  assert.match(homePage, /readHomeAssistantRuntimeState/);
  assert.match(homePage, /writeHomeAssistantRuntimeState/);
  assert.match(homePage, /clearHomeAssistantRuntimeState/);
  assert.match(homePage, /setMessages\(restoredChatState\.messages\)/);
  assert.match(homePage, /setActiveListingQuery\(restoredChatState\.activeListingQuery\)/);
  assert.match(homePage, /clearHomeAssistantRuntimeState\(\)/);
  assert.doesNotMatch(homePage, /sessionStorage\.setItem\(\s*currentChatStorageKey/);
});

test('primary mobile navigation closes the visible assistant chat view only', () => {
  const homePage = readProjectFile('app', 'page.tsx');
  const mobileNavigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');
  const closeNavigationMatch = homePage.match(
    /const closeAssistantForNavigation = useCallback\([\s\S]*?\n  \}, \[collapseAssistant, resetChatKeyboardState\]\);/,
  );
  const closeNavigationHandler = closeNavigationMatch?.[0] ?? '';

  assert.match(homePage, /smartstore:close-assistant-view/);
  assert.match(homePage, /closeAssistantForNavigation/);
  assert.match(closeNavigationHandler, /setIsMobileChatViewOpen\(false\)/);
  assert.match(closeNavigationHandler, /resetChatKeyboardState\(\)/);
  assert.match(closeNavigationHandler, /url\.searchParams\.delete\('chat'\)/);
  assert.doesNotMatch(closeNavigationHandler, /clearHomeAssistantRuntimeState/);
  assert.match(mobileNavigation, /closeAssistantViewForPrimaryNavigation/);
  assert.match(mobileNavigation, /href !== '\/' && href !== '\/account'/);
  assert.match(mobileNavigation, /smartstore:close-assistant-view/);
});

test('mobile chat view resets keyboard tracking when opened or closed', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /const resetChatKeyboardState = useCallback/);
  assert.match(homePage, /setIsChatInputFocused\(false\)/);
  assert.match(homePage, /setKeyboardOffset\(0\)/);
  assert.match(homePage, /keyboardBaselineViewportHeightRef\.current = null/);
  assert.match(homePage, /const openMobileChatView = useCallback\([\s\S]*resetChatKeyboardState\(\)/);
  assert.match(homePage, /const closeMobileChatView = useCallback\([\s\S]*resetChatKeyboardState\(\)/);
  assert.match(homePage, /syncMobileChatViewFromUrl[\s\S]*resetChatKeyboardState\(\)/);
});

test('mobile chat view keeps input attached to the keyboard while focused', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /const compactChatViewStyle = useMemo/);
  assert.match(homePage, /type VisualViewportFrame/);
  assert.match(homePage, /const \[visualViewportFrame, setVisualViewportFrame\]/);
  assert.match(homePage, /if \(!isCompactViewport \|\| !isMobileChatViewOpen\)/);
  assert.match(homePage, /insetInline: '0\.5rem'/);
  assert.match(homePage, /position: 'fixed'/);
  assert.match(homePage, /top: `\$\{visualViewportFrame\.offsetTop \+ 8\}px`/);
  assert.match(homePage, /height: `\$\{focusedPanelHeight\}px`/);
  assert.match(homePage, /isCompactChatView && isChatInputFocused && 'transition-none'/);
  assert.match(homePage, /style=\{isCompactChatView \? compactChatViewStyle : assistantPanelStyle\}/);
  assert.doesNotMatch(homePage, /height: `calc\(100dvh - \$\{keyboardOffset\}px\)`/);
});

test('mobile chat submit dismisses the keyboard before sending', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /if \(isCompactViewport\) \{/);
  assert.match(homePage, /activeElement\.blur\(\)/);
  assert.match(homePage, /resetChatKeyboardState\(\)/);
});

test('mobile bottom navigation is hidden while assistant chat view is open', () => {
  const homePage = readProjectFile('app', 'page.tsx');
  const mobileNavigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');

  assert.match(homePage, /smartstore:assistant-chat-view-change/);
  assert.doesNotMatch(mobileNavigation, /useSearchParams/);
  assert.match(mobileNavigation, /const \[isAssistantChatViewOpen, setIsAssistantChatViewOpen\]/);
  assert.match(mobileNavigation, /window\.location\.href/);
  assert.match(mobileNavigation, /searchParams\.get\('chat'\) === '1'/);
  assert.match(mobileNavigation, /smartstore:assistant-chat-view-change/);
  assert.match(mobileNavigation, /isAssistantChatViewOpen[\s\S]*return null/);
});

test('mobile bottom navigation exposes messages with a visible label', () => {
  const mobileNavigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');

  assert.match(mobileNavigation, /href: '\/conversations'/);
  assert.match(mobileNavigation, /label: 'محادثاتي'/);
  assert.match(mobileNavigation, /grid-cols-4/);
  assert.match(mobileNavigation, /w-1\/4/);
  assert.match(mobileNavigation, /aria-label=\{item\.label\}/);
  assert.doesNotMatch(mobileNavigation, /iconOnly/);
  assert.doesNotMatch(mobileNavigation, /sr-only/);
  assert.match(mobileNavigation, /active[\s\S]*size-10 bg-blue-600 text-white/);
  assert.doesNotMatch(mobileNavigation, /item\.primary \? \([\s\S]*bg-blue-600 text-white/);
});

test('home assistant starter search is generic instead of a fixed car city example', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /'أبحث عن منتج'/);
  assert.doesNotMatch(homePage, /'أبحث عن سيارة في الرياض'/);
});
