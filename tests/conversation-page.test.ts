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

  assert.match(source, /messagesEndRef/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /visibleMessages\.length/);
  assert.match(source, /flex min-h-full flex-col justify-end gap-3/);
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

test('seller buyer conversation does not imply سوق حمد guarantees payment transfers', () => {
  const source = readConversationPage();

  assert.match(source, /تحويل الأموال بين البائع والمشتري مسؤولية الطرفين/);
  assert.match(source, /المنصة لا تضمنه/);
  assert.doesNotMatch(source, /التواصل والدفع داخل سوق حمد/);
});
test('conversations list uses compact cards with a small delete menu', () => {
  const source = readConversationsIndexPage();

  assert.match(source, /DropdownMenu/);
  assert.match(source, /MoreVertical/);
  assert.match(source, /حذف المحادثة/);
  assert.match(source, /هل أنت متأكد من حذف هذه المحادثة؟/);
  assert.match(source, /تم حذف المحادثة بنجاح/);
  assert.match(source, /تعذر حذف المحادثة\. حاول مرة أخرى/);
  assert.match(source, /grid-cols-\[3\.75rem_minmax\(0,1fr\)_auto\]/);
});

test('conversations list keeps each conversation card horizontal on every viewport', () => {
  const source = readConversationsIndexPage();
  const cardLinkMatch = source.match(
    /className="([^"]*grid min-w-0 grid-cols-\[3\.75rem_minmax\(0,1fr\)_auto\][^"]*)"/,
  );

  assert.ok(cardLinkMatch, 'conversation card link should use a fixed horizontal grid');
  assert.doesNotMatch(cardLinkMatch[1], /\b(?:sm|md|lg|xl):grid-cols-/);
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

test('conversation read state is marked by the server and shown quietly in UI', () => {
  const route = readConversationRoute();
  const repository = readMarketplaceRepository();
  const conversationPage = readConversationPage();
  const conversationsPage = readConversationsIndexPage();

  assert.match(route, /markConversationReadForUser/);
  assert.match(repository, /readBy/);
  assert.match(repository, /senderId: \{ not: userId \}/);
  assert.match(conversationPage, /تمت القراءة/);
  assert.match(conversationPage, /غير مقروءة/);
  assert.match(conversationsPage, /غير مقروءة/);
  assert.match(conversationsPage, /hasUnreadMessages/);
});

test('conversation navigation alert syncs unread state from the server', () => {
  const hook = readConversationAlertHook();

  assert.match(hook, /syncUnreadConversations/);
  assert.match(hook, /\/api\/marketplace\/me\/conversations/);
  assert.match(hook, /conversation_updated/);
  assert.match(hook, /readBy/);
});
