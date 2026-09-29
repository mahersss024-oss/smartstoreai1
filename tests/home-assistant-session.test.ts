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
  assert.match(closeNavigationHandler, /url\.searchParams\.delete\('assistant'\)/);
  assert.match(closeNavigationHandler, /url\.searchParams\.delete\('listingId'\)/);
  assert.doesNotMatch(closeNavigationHandler, /clearHomeAssistantRuntimeState/);
  assert.match(mobileNavigation, /closeAssistantViewForPrimaryNavigation/);
  assert.match(mobileNavigation, /href !== '\/' && href !== '\/account'/);
  assert.match(mobileNavigation, /smartstore:close-assistant-view/);
});

test('listing details does not show Hamad comparison while home can still return to the listing', () => {
  const homePage = readProjectFile('app', 'page.tsx');
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');

  assert.doesNotMatch(listingPage, /getListingAssistantHref/);
  assert.doesNotMatch(listingPage, /assistant=listing&listingId=/);
  assert.doesNotMatch(listingPage, /listingAssistantHref/);
  assert.doesNotMatch(listingPage, /hamad-assistant-bubble\.webp/);
  assert.match(homePage, /isSafeListingId/);
  assert.doesNotMatch(homePage, /const \[assistantReturnListingId, setAssistantReturnListingId\]/);
  assert.match(homePage, /handledListingAssistantRef/);
  assert.match(homePage, /url\.searchParams\.get\('assistant'\)/);
  assert.match(homePage, /url\.searchParams\.get\('listingId'\)/);
  assert.match(homePage, /assistantMode !== 'listing'/);
  assert.match(homePage, /sendStarter\(`قارن لي الإعلان رقم \$\{listingId\} مع السوق`\)/);
  assert.doesNotMatch(homePage, /assistantReturnListingHref/);
  assert.doesNotMatch(homePage, /href=\{assistantReturnListingHref\}/);
  assert.doesNotMatch(homePage, /aria-label="العودة للإعلان"/);
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
  assert.match(homePage, /const assistantScrollWatchKey = useMemo/);
  assert.match(homePage, /type VisualViewportFrame/);
  assert.match(homePage, /const \[visualViewportFrame, setVisualViewportFrame\]/);
  assert.match(homePage, /if \(!isCompactViewport \|\| !isMobileChatViewOpen\)/);
  assert.match(homePage, /width: 'calc\(100% - 2rem\)'/);
  assert.match(homePage, /maxWidth: '40rem'/);
  assert.match(homePage, /position: 'fixed'/);
  assert.match(homePage, /top: `\$\{visualViewportFrame\.offsetTop \+ 8\}px`/);
  assert.match(homePage, /height: `\$\{focusedPanelHeight\}px`/);
  assert.match(homePage, /isCompactChatView && isChatInputFocused && 'transition-none'/);
  assert.match(homePage, /style=\{isCompactChatView \? compactChatViewStyle : assistantPanelStyle\}/);
  assert.match(homePage, /watchKey=\{assistantScrollWatchKey\}/);
  assert.doesNotMatch(homePage, /height: `calc\(100dvh - \$\{keyboardOffset\}px\)`/);
  assert.match(homePage, /minHeight: '3rem'/);
  assert.match(homePage, /gridTemplateColumns: '2\.75rem minmax\(0, 1fr\) 2\.75rem'/);
  assert.match(homePage, /max-h-20 min-h-10 resize-none/);
  assert.match(homePage, /className="shrink-0 border-t p-1\.5"/);
});

test('mobile chat submit keeps the keyboard open until the user dismisses it', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  const submitHandler = homePage.match(
    /const handleSubmit = useCallback\([\s\S]*?\n  \);/,
  )?.[0] ?? '';

  assert.doesNotMatch(submitHandler, /activeElement\.blur\(\)/);
  assert.doesNotMatch(submitHandler, /resetChatKeyboardState\(\)/);
  assert.match(homePage, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.doesNotMatch(homePage, /onPointerDown=\{\(\) => \{\s*const activeElement = document\.activeElement/);
  assert.match(homePage, /handleAssistantChatPointerDown/);
  assert.match(homePage, /handleAssistantChatPointerMove/);
  assert.match(homePage, /handleAssistantChatPointerUp/);
  assert.match(homePage, /handleAssistantChatPointerCancel/);
  assert.match(homePage, /isKeyboardDismissIgnoredTarget/);
  assert.match(homePage, /isRepeatedTap/);
});

test('home assistant keeps only user messages in compact bubbles', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /message\.role === 'assistant'/);
  assert.match(homePage, /<AssistantMessageFrame>/);
  assert.match(homePage, /isUserImageMessagePart/);
  assert.match(homePage, /isRenderableUserBubblePart/);
  assert.match(homePage, /part\.text\.trim\(\)\.length > 0/);
  assert.match(homePage, /userImageParts/);
  assert.match(homePage, /userContentParts/);
  assert.match(homePage, /message\.parts\.filter\(isRenderableUserBubblePart\)/);
  assert.match(homePage, /key=\{`user-image-\$\{message\.id\}-\$\{partIndex\}`\}/);
  assert.match(homePage, /max-w-\[min\(74%,30rem\)\]/);
  assert.match(homePage, /overflow-hidden break-words/);
  assert.match(homePage, /\[overflow-wrap:anywhere\]/);
  assert.match(homePage, /text-\[0\.86rem\]/);
  assert.match(homePage, /rounded-br-md border border-blue-600 bg-blue-600/);
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

  assert.match(mobileNavigation, /href: '\/account\/listings'/);
  assert.match(mobileNavigation, /label: 'إعلاناتي'/);
  assert.match(mobileNavigation, /href: '\/conversations'/);
  assert.match(mobileNavigation, /label: 'محادثاتي'/);
  assert.match(mobileNavigation, /href: '\/favorites'/);
  assert.match(mobileNavigation, /label: 'المفضلة'/);
  assert.match(mobileNavigation, /grid-cols-5/);
  assert.match(mobileNavigation, /w-1\/5/);
  assert.match(mobileNavigation, /aria-label=\{item\.label\}/);
  assert.doesNotMatch(mobileNavigation, /المزيد/);
  assert.doesNotMatch(mobileNavigation, /iconOnly/);
  assert.doesNotMatch(mobileNavigation, /sr-only/);
  assert.match(mobileNavigation, /bottom-\[calc\(0\.18rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(mobileNavigation, /top-\[calc\(100%\+0\.08rem\)\]/);
  assert.match(mobileNavigation, /bg-white\/22 backdrop-blur-\[72px\]/);
  assert.match(mobileNavigation, /fixed inset-x-1/);
  assert.match(mobileNavigation, /grid h-14 grid-cols-5/);
  assert.match(mobileNavigation, /text-\[13px\] font-bold/);
  assert.match(mobileNavigation, /active[\s\S]*item\.primary[\s\S]*size-10 bg-blue-600 text-white/);
  assert.match(mobileNavigation, /ring-4 ring-blue-500\/15/);
});

test('mobile bottom navigation highlights conversations when a new message arrives', () => {
  const mobileNavigation = readProjectFile('components', 'mobile-bottom-navigation.tsx');
  const alertHook = readProjectFile('hooks', 'use-conversation-message-alert.ts');

  assert.match(mobileNavigation, /useConversationMessageAlert/);
  assert.match(mobileNavigation, /alert: hasConversationAlert/);
  assert.match(mobileNavigation, /showAlert/);
  assert.match(mobileNavigation, /shadow-\[0_0_18px_rgba\(244,63,94,0\.55\)\]/);
  assert.match(mobileNavigation, /from-rose-300 to-red-600/);
  assert.match(alertHook, /useSmartstoreRealtime/);
  assert.match(alertHook, /eventTypes: \['message_created', 'conversation_updated'\]/);
  assert.match(alertHook, /senderId !== currentUserId/);
  assert.match(alertHook, /syncUnreadConversations/);
  assert.match(alertHook, /smartstore_conversation_alert/);
  assert.match(alertHook, /pathname\.startsWith\('\/conversations'\)/);
});

test('tablet keeps account access in the bottom navigation instead of the top header', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /href="\/account" onClick=\{closeAssistantForNavigation\}/);
  assert.match(homePage, /className="hidden rounded-md lg:inline-flex"/);
  assert.doesNotMatch(homePage, /className="hidden rounded-md sm:inline-flex"[\s\S]*href="\/account"/);
});

test('home assistant starter search is generic instead of a fixed car city example', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /'أبحث عن منتج'/);
  assert.doesNotMatch(homePage, /'أبحث عن سيارة في الرياض'/);
});
