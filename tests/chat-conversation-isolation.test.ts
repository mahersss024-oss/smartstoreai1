import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { parseChatConversationId } from '@/lib/chat/conversation';
import { createSessionCookie } from '@/lib/auth/session';
import { POST } from '@/app/api/chat/route';
import { POST as resetChat } from '@/app/api/chat/reset/route';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { createListingDraft, getListing, publishListing, resetMarketplaceStoreForTests } from '@/agent/marketplace/store';
import { getRealtimeEventsSince } from '@/lib/realtime/event-bus';
import { mockAllowedTextAnalysis, textAnalysis } from './helpers/text-understanding';

const firstConversation = '11111111-1111-4111-8111-111111111111';
const secondConversation = '22222222-2222-4222-8222-222222222222';
const user = { id: 'google:isolated-chat-owner', email: 'isolated@example.test' };

beforeEach(t => { resetMarketplaceStoreForTests(); mockAllowedTextAnalysis(t); });

function request(conversationId: string, reset = false) {
  return new Request(`http://localhost/api/chat${reset ? '/reset' : ''}`, {
    method: 'POST', headers: { cookie: createSessionCookie(user), 'content-type': 'application/json',
      ...(reset ? { 'x-chat-conversation-id': conversationId } : {}) },
    body: reset ? undefined : JSON.stringify({ chatOwnerId: user.id, chatConversationId: conversationId,
      messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'هاتف' }] }] }),
  });
}

test('conversation IDs are validated without legacy search owner namespaces', () => {
  for (const valid of [firstConversation, secondConversation]) assert.equal(parseChatConversationId(valid), valid);
  for (const invalid of ['', 'short', 'x'.repeat(81), 'a/b'.repeat(10), 123, null]) assert.equal(parseChatConversationId(invalid), null);
});

test('malformed conversation identifiers are rejected before model calls or draft cleanup', async t => {
  const draft = createListingDraft({ sellerId: user.id, category: 'cars' });
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => null);
  assert.equal((await POST(request('bad/id'))).status, 400);
  assert.equal((await resetChat(request('bad/id', true))).status, 400);
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(getListing(draft.id)?.status, 'draft');
});

test('a stale tab cannot reset the newly authenticated account drafts', async () => {
  const draft = createListingDraft({ sellerId: user.id, category: 'cars' });
  const response = await resetChat(new Request('http://localhost/api/chat/reset', { method: 'POST', headers: {
    cookie: createSessionCookie(user), 'x-chat-conversation-id': firstConversation, 'x-chat-owner-id': 'previous-account',
  } }));
  assert.equal(response.status, 409);
  assert.equal(getListing(draft.id)?.status, 'draft');
});

test('chat reset preserves published ads and another account drafts', async () => {
  const incomplete = createListingDraft({ sellerId: user.id, category: 'cars' });
  const otherAccount = createListingDraft({ sellerId: 'other-chat-owner', category: 'cars' });
  const published = createListingDraft({ sellerId: user.id, category: 'cars', title: 'إعلان منشور', description: 'تفاصيل الإعلان' });
  publishListing(published.id);
  assert.equal((await resetChat(request(firstConversation, true))).status, 200);
  assert.equal(getListing(incomplete.id)?.status, 'deleted');
  assert.equal(getListing(otherAccount.id)?.status, 'draft');
  assert.equal(getListing(published.id)?.status, 'published');
});

test('the real chat route cannot execute old product searches or emit marketplace notifications', async t => {
  const analysis = textAnalysis({ intent: 'search_listing' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    const checker = body.messages.some((message: { content: unknown }) => typeof message.content === 'string' && message.content.includes('output Scope Checker'));
    if (!checker) assert.deepEqual(body.tools.map((tool: { function: { name: string } }) => tool.function.name), ['getPlatformHelp']);
    return Response.json({ id: 'scoped-help', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
        content: checker ? JSON.stringify({ decision: 'ALLOW', confidence: 1, reason_code: 'verified' }) : 'البحث عن المنتجات ليس من دوري. يمكنك استخدام بحث السوق بنفسك.',
      } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const beforeEvents = getRealtimeEventsSince(null, { userId: user.id, isAdmin: false });
  for (const id of [firstConversation, secondConversation]) {
    const response = await POST(request(id));
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /ليس من دوري/);
    assert.doesNotMatch(stream, /tool-output-available/);
  }
  assert.deepEqual(getRealtimeEventsSince(null, { userId: user.id, isAdmin: false }), beforeEvents);
});
