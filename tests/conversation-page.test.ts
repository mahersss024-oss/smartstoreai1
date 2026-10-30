import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

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

test('conversation message deletion contracts survive web UI retirement', () => {
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

  assert.match(route, /action: z\.literal\('delete_message'\)/);
  assert.match(route, /deleteConversationMessageForUser/);
  assert.match(route, /message_delete_not_allowed/);
  assert.match(repository, /deletedFor/);
  assert.match(repository, /deletedForEveryone/);
  assert.match(repository, /UPDATE "ConversationMessage" AS message[\s\S]*"body" = CASE WHEN \$\{deleteEveryone\} THEN 'message_deleted' ELSE message\."body" END,[\s\S]*"type" = CASE WHEN \$\{deleteEveryone\} THEN 'message_deleted' ELSE message\."type" END/);
  assert.match(repository, /mergeConversationMessageMetadata\(message\.id, userId, 'deletedForEveryone',[\s\S]*by: userId,[\s\S]*at: deletedAt,[\s\S]*\}, true\)/);
  assert.match(memoryStore, /deleteConversationMessageForUser/);
  assert.match(types, /'message_deleted'/);
});

test('conversation read and delivery state remain enforced by existing APIs', () => {
  const route = readConversationRoute();
  const conversationsRoute = readConversationsRoute();
  const repository = readMarketplaceRepository();

  assert.match(route, /markConversationReadForUser/);
  assert.match(route, /markConversationsDeliveredForUser/);
  assert.match(conversationsRoute, /markConversationsDeliveredForUser/);
  assert.match(repository, /readBy/);
  assert.match(repository, /deliveredTo/);
  assert.match(repository, /senderId: \{ not: userId \}/);
});

test('conversation navigation alert syncs unread state from the server', () => {
  const hook = readConversationAlertHook();

  assert.match(hook, /syncUnreadConversations/);
  assert.match(hook, /\/api\/marketplace\/me\/conversations/);
  assert.match(hook, /scheduleIdleTask/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /window\.addEventListener\('focus'/);
  assert.doesNotMatch(hook, /useSmartstoreRealtime/);
  assert.match(hook, /readBy/);
});
