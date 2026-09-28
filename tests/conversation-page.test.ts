import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readConversationPage() {
  return readFileSync(
    join(process.cwd(), 'app', 'conversations', '[conversationId]', 'page.tsx'),
    'utf8',
  );
}

function readConversationsIndexPage() {
  return readFileSync(
    join(process.cwd(), 'app', 'conversations', 'page.tsx'),
    'utf8',
  );
}

function readConversationRoute() {
  return readFileSync(
    join(
      process.cwd(),
      'app',
      'api',
      'marketplace',
      'conversations',
      '[conversationId]',
      'route.ts',
    ),
    'utf8',
  );
}

function readConversationsRoute() {
  return readFileSync(
    join(
      process.cwd(),
      'app',
      'api',
      'marketplace',
      'me',
      'conversations',
      'route.ts',
    ),
    'utf8',
  );
}

function readConversationAlertHook() {
  return readFileSync(
    join(process.cwd(), 'hooks', 'use-conversation-message-alert.ts'),
    'utf8',
  );
}

function readMarketplaceRepository() {
  return readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'repository.ts'),
    'utf8',
  );
}

test('seller buyer conversation scrolls to the latest message', () => {
  const source = readConversationPage();

  assert.match(source, /messagesContainerRef/);
  assert.match(source, /scrollConversationToLatest/);
  assert.match(source, /messagesContainer\.scrollTo/);
  assert.match(source, /messagesContainer\.scrollHeight/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.match(source, /visibleMessages\.length/);
  assert.match(source, /flex min-h-full flex-col justify-end gap-1/);
  assert.match(source, /formatMessageDate/);
  assert.match(source, /isSameMessageDay/);
});

test('seller buyer conversation fills the mobile viewport and keeps the keyboard open after send', () => {
  const source = readConversationPage();

  assert.match(source, /h-dvh overflow-hidden/);
  assert.match(source, /min-h-0 flex-1 overscroll-contain overflow-y-auto/);
  assert.doesNotMatch(source, /onPointerDown=\{\(\) => messageInputRef\.current\?\.blur\(\)\}/);
  assert.match(source, /handleMessagesPointerDown/);
  assert.match(source, /handleMessagesPointerMove/);
  assert.match(source, /handleMessagesPointerUp/);
  assert.match(source, /isKeyboardDismissIgnoredTarget/);
  assert.match(source, /isRepeatedTap/);
  assert.match(source, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(source, /max-h-20 min-h-10/);
  assert.match(source, /text-\[0px\]/);
  assert.match(source, /window\.visualViewport/);
  assert.match(source, /height: `\$\{visualViewportFrame\.height\}px`/);
  assert.match(source, /handleMessageInputFocus/);
  assert.match(source, /window\.setTimeout\(scrollConversationToLatest, 180\)/);
});

test('mobile navigation hides inside an open conversation', () => {
  const source = readConversationPage();
  const mobileNavigation = readFileSync(
    join(process.cwd(), 'components', 'mobile-bottom-navigation.tsx'),
    'utf8',
  );

  assert.match(mobileNavigation, /pathname\.startsWith\('\/conversations\/'\)/);
  assert.match(
    source,
    /w-full max-w-6xl flex-col gap-0 overflow-hidden px-0 pb-\[env\(safe-area-inset-bottom\)\] pt-0/,
  );
  assert.match(source, /rounded-none bg-white/);
  assert.match(source, /px-3 py-2 dark:bg-background/);
  assert.doesNotMatch(source, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(source, /focus-within:pb-0/);
});

test('seller buyer conversation exposes report and block controls', () => {
  const source = readConversationPage();

  assert.match(source, /reportConversationUser/);
  assert.match(source, /blockConversationParticipant/);
  assert.match(source, /unblockConversationParticipant/);
  assert.match(source, /action: 'report_user'/);
  assert.match(source, /action: 'block_user'/);
  assert.match(source, /action: 'unblock_user'/);
  assert.match(source, /canUnblockConversation/);
  assert.match(source, /isConversationBlocked/);
});

test('seller buyer conversation header shows the other customer, not the listing title', () => {
  const source = readConversationPage();
  const repository = readMarketplaceRepository();

  assert.match(source, /type ConversationParticipant/);
  assert.match(source, /otherParticipantName/);
  assert.match(source, /otherParticipantProfileHref/);
  assert.match(source, /encodeURIComponent\(otherParticipantId\)/);
  assert.match(source, /otherParticipant\?\.picture/);
  assert.match(source, /getParticipantInitial\(otherParticipantName\)/);
  assert.match(source, /href=\{otherParticipantProfileHref\}/);
  assert.match(source, /DropdownMenuTrigger/);
  assert.match(source, /MoreVertical/);
  assert.doesNotMatch(source, /<Bot className="size-4" \/>/);
  assert.doesNotMatch(source, /session\.authenticated \? roleLabel/);
  assert.doesNotMatch(source, /conversation\?\.status === 'open'/);
  assert.doesNotMatch(source, /conversation\?\.listing\?\.title \?\? 'سوق حمد'/);
  assert.match(repository, /seller: \{/);
  assert.match(repository, /buyer: \{/);
  assert.match(repository, /lastActiveAt: true/);
  assert.match(source, /getParticipantPresence/);
  assert.match(source, /conversationOnlineWindowMs/);
});

test('seller buyer conversation shows a compact listing card linking to details', () => {
  const source = readConversationPage();

  assert.match(source, /conversationListingHref/);
  assert.match(source, /source=conversation&conversationId=/);
  assert.match(source, /className="size-20 shrink-0/);
  assert.match(source, /className="line-clamp-2 text-sm font-bold/);
  assert.doesNotMatch(source, /className="aspect-square w-full rounded-md object-cover"/);
  assert.doesNotMatch(source, /grid h-fit gap-4 rounded-md border bg-white p-4 shadow-sm/);
});

test('seller buyer conversation handles non-json send failures safely', () => {
  const source = readConversationPage();

  assert.match(source, /let payload: \{/);
  assert.match(source, /await response\.json\(\)/);
  assert.match(source, /catch \{/);
  assert.match(source, /payload = \{\}/);
});

test('seller buyer conversation preserves newer draft text after send', () => {
  const source = readConversationPage();

  assert.match(source, /const messageBody = draft\.trim\(\)/);
  assert.match(source, /currentDraft\.trim\(\) === messageBody/);
});

test('seller buyer conversation sends with Enter and keeps Shift Enter for new lines', () => {
  const source = readConversationPage();

  assert.match(source, /KeyboardEvent/);
  assert.match(source, /sendConversationMessageWithEnter/);
  assert.match(source, /event\.key !== 'Enter' \|\| event\.shiftKey/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(source, /onKeyDown=\{sendConversationMessageWithEnter\}/);
});

test('seller buyer conversation hides blocked messages and uses official contact sharing', () => {
  const source = readConversationPage();

  assert.match(source, /message\.status === 'sent'/);
  assert.match(source, /shareOfficialContact/);
  assert.match(source, /action: 'share_contact'/);
  assert.match(source, /message\.type === 'contact_share'/);
  assert.match(source, /مشاركة الرقم/);
  assert.match(source, /مشاركة معلومات التواصل أو الدفع خارج المنصة مسؤوليتك/);
  assert.doesNotMatch(source, /لا يمكن إرسال أرقام الجوال أو الإيميلات يدويًا/);
  assert.doesNotMatch(source, /محجوبة/);
});

test('seller buyer conversation keeps persistent chat guidance minimal', () => {
  const source = readConversationPage();
  const conversationsIndex = readConversationsIndexPage();

  assert.doesNotMatch(source, /ShieldCheck/);
  assert.doesNotMatch(source, /BadgeCheck/);
  assert.doesNotMatch(source, /flex items-start gap-2 rounded-md border bg-blue-50/);
  assert.doesNotMatch(source, /grid max-w-xs gap-3/);
  assert.doesNotMatch(source, /محادثة سوق حمد/);
  assert.doesNotMatch(source, /تواصل داخلي آمن بين البائع والمشتري/);
  assert.doesNotMatch(conversationsIndex, /محادثات البيع والشراء داخل سوق حمد/);
});
test('conversations list uses compact cards with a small delete menu', () => {
  const source = readConversationsIndexPage();

  assert.match(source, /DropdownMenu/);
  assert.match(source, /MoreVertical/);
  assert.match(source, /حذف المحادثة/);
  assert.match(source, /هل أنت متأكد من حذف هذه المحادثة؟/);
  assert.match(source, /تم حذف المحادثة بنجاح/);
  assert.match(source, /تعذر حذف المحادثة\. حاول مرة أخرى/);
  assert.match(source, /grid-cols-\[2\.75rem_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /sm:grid-cols-\[3rem_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /otherParticipantName/);
  assert.match(source, /otherParticipant\?\.picture/);
  assert.doesNotMatch(source, /rounded-md border bg-white p-2 shadow-sm/);
  assert.doesNotMatch(source, /rounded-md border bg-white p-6 text-center shadow-sm/);
  assert.doesNotMatch(source, /formatPrice\(conversation\.listing\?\.price\)/);
});

test('conversations list keeps each conversation card horizontal on every viewport', () => {
  const source = readConversationsIndexPage();
  const cardLinkMatch = source.match(
    /className="([^"]*grid min-w-0 grid-cols-\[2\.75rem_minmax\(0,1fr\)_auto\][^"]*)"/,
  );

  assert.ok(cardLinkMatch, 'conversation card link should use a fixed horizontal grid');
  assert.doesNotMatch(cardLinkMatch[1], /\b(?:md|lg|xl):grid-cols-/);
  assert.doesNotMatch(cardLinkMatch[1], /\b(?:sm|md|lg|xl):flex-col\b/);
});

test('conversation deletion is enforced by the server route', () => {
  const route = readConversationRoute();
  const repository = readMarketplaceRepository();

  assert.match(route, /export async function DELETE/);
  assert.match(route, /getAuthSession/);
  assert.match(route, /deleteConversationForUser/);
  assert.match(route, /conversation_not_found/);
  assert.match(repository, /type: 'conversation_hidden'/);
  assert.match(repository, /prisma\.conversationMessage\.upsert/);
  assert.doesNotMatch(repository, /prisma\.conversation\.delete\(/);
  assert.match(repository, /userIds: \[userId\]/);
});

test('conversation messages support long press deletion without removing the thread', () => {
  const route = readConversationRoute();
  const repository = readMarketplaceRepository();
  const memoryStore = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'store.ts'),
    'utf8',
  );
  const types = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'types.ts'),
    'utf8',
  );
  const page = readConversationPage();

  assert.match(route, /action: z\.literal\('delete_message'\)/);
  assert.match(route, /deleteConversationMessageForUser/);
  assert.match(route, /message_delete_not_allowed/);
  assert.match(repository, /deletedFor/);
  assert.match(repository, /deletedForEveryone/);
  assert.match(repository, /type: 'message_deleted'/);
  assert.match(memoryStore, /deleteConversationMessageForUser/);
  assert.match(types, /'message_deleted'/);
  assert.match(page, /handleMessageLongPressStart/);
  assert.match(page, /onContextMenu/);
  assert.match(page, /deleteConversationMessage\('for_me'\)/);
  assert.match(page, /deleteConversationMessage\('for_everyone'\)/);
  assert.match(page, /isMessageDeletedFor/);
  assert.match(page, /isMessageDeletedForEveryone/);
  assert.match(page, /تم حذف هذه الرسالة/);
});

test('conversation read state is marked by the server and shown quietly in UI', () => {
  const route = readConversationRoute();
  const conversationsRoute = readConversationsRoute();
  const repository = readMarketplaceRepository();
  const conversationPage = readConversationPage();
  const conversationsPage = readConversationsIndexPage();

  assert.match(route, /markConversationReadForUser/);
  assert.match(route, /markConversationsDeliveredForUser/);
  assert.match(conversationsRoute, /markConversationsDeliveredForUser/);
  assert.match(repository, /readBy/);
  assert.match(repository, /deliveredTo/);
  assert.match(repository, /senderId: \{ not: userId \}/);
  assert.match(conversationPage, /تمت القراءة/);
  assert.match(conversationPage, /تم التسليم/);
  assert.doesNotMatch(conversationPage, /غير مقروءة/);
  assert.match(conversationPage, /تم الإرسال/);
  assert.match(conversationPage, /✓✓/);
  assert.match(conversationsPage, /hasUnreadMessages/);
  assert.match(conversationsPage, /hasUnreadMessages/);
});

test('conversation navigation alert syncs unread state from the server', () => {
  const hook = readConversationAlertHook();

  assert.match(hook, /syncUnreadConversations/);
  assert.match(hook, /\/api\/marketplace\/me\/conversations/);
  assert.match(hook, /conversation_updated/);
  assert.match(hook, /readBy/);
});
