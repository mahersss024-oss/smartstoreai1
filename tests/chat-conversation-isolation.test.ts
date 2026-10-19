import assert from 'node:assert/strict';
import test from 'node:test';
import { getChatSearchOwnerKey } from '@/lib/chat/search-owner';
import { parseChatConversationId } from '@/lib/chat/conversation';
import { createSessionCookie } from '@/lib/auth/session';
import { POST } from '@/app/api/chat/route';
import { POST as resetChat } from '@/app/api/chat/reset/route';
import { getMarketplaceSearchState, updateMarketplaceSearchState } from '@/agent/marketplace/search-state';
import { parseExplicitMarketplaceSearchIntent } from '@/agent/marketplace/structured-search-intent';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { getRealtimeEventsSince } from '@/lib/realtime/event-bus';
import { textAnalysis } from './helpers/text-understanding';

const firstConversation = '11111111-1111-4111-8111-111111111111';
const secondConversation = '22222222-2222-4222-8222-222222222222';
const user = { id: 'google:isolated-search-owner', email: 'isolated@example.test' };
const session = { user, issuedAt: 1, expiresAt: 2 };

function request(conversationId: string, reset = false) {
  return new Request(`http://localhost/api/chat${reset ? '/reset' : ''}`, {
    method: 'POST', headers: { cookie: createSessionCookie(user), 'content-type': 'application/json',
      ...(reset ? { 'x-chat-conversation-id': conversationId } : {}) },
    body: reset ? undefined : JSON.stringify({ chatOwnerId: user.id, chatConversationId: conversationId,
      messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'هاتف' }] }] }),
  });
}

test('conversation search keys stay stable per conversation and are always scoped to the authenticated account', () => {
  const req = request(firstConversation);
  const firstKey = getChatSearchOwnerKey(session, req, firstConversation);
  assert.equal(firstKey, getChatSearchOwnerKey(session, req, firstConversation));
  assert.notEqual(firstKey, getChatSearchOwnerKey(session, req, secondConversation));
  assert.notEqual(firstKey, getChatSearchOwnerKey({ ...session, user: { ...user, id: 'another-account' } }, req, firstConversation));
  assert.equal(getChatSearchOwnerKey(session, req), `user:${user.id}`, 'legacy clients retain their existing namespace');
  for (const invalid of ['', 'short', 'x'.repeat(81), 'a/b'.repeat(10), 123, null]) assert.equal(parseChatConversationId(invalid), null);
});

for (const store of ['file', 'database'] as const) {
  test(`search refinements and resets cannot overwrite another conversation in ${store} storage`, async t => {
    const originalStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
    process.env.SMARTSTORE_MARKETPLACE_STORE = store;
    t.after(() => {
      if (originalStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
      else process.env.SMARTSTORE_MARKETPLACE_STORE = originalStore;
    });
    if (store === 'database') {
      const { prisma } = await import('@/lib/db/prisma');
      const rows = new Map<string, unknown>();
      const delegate = prisma.marketplaceSearchState;
      const original = { findUnique: delegate.findUnique, upsert: delegate.upsert, deleteMany: delegate.deleteMany };
      Object.assign(delegate, {
        findUnique: async ({ where }: { where: { ownerKey: string } }) => rows.has(where.ownerKey) ? { state: rows.get(where.ownerKey) } : null,
        upsert: async ({ where, update }: { where: { ownerKey: string }; update: { state: unknown } }) => { rows.set(where.ownerKey, update.state); return {}; },
        deleteMany: async ({ where }: { where: { ownerKey: string } }) => ({ count: Number(rows.delete(where.ownerKey)) }),
      });
      t.after(() => Object.assign(delegate, original));
      // Draft cleanup is an existing reset operation and is isolated from the state delegate here.
      t.mock.method(prisma, '$transaction', async () => []);
    }
    const firstKey = getChatSearchOwnerKey(session, request(firstConversation), firstConversation);
    const secondKey = getChatSearchOwnerKey(session, request(secondConversation), secondConversation);
    await updateMarketplaceSearchState(firstKey, parseExplicitMarketplaceSearchIntent('هاتف', { city: 'Riyadh' }));
    await updateMarketplaceSearchState(secondKey, parseExplicitMarketplaceSearchIntent('سيارة', { city: 'Jeddah' }));
    const refined = await updateMarketplaceSearchState(firstKey, parseExplicitMarketplaceSearchIntent(undefined, { searchMode: 'refine', maxPrice: 100 }));
    assert.equal(refined.city, 'Riyadh');
    assert.deepEqual(refined.terms, ['هاتف']);
    assert.equal(refined.maxPrice, 100);
    assert.equal((await getMarketplaceSearchState(secondKey))?.city, 'Jeddah');
    const beforeReset = await getMarketplaceSearchState(secondKey);
    assert.equal((await resetChat(request(firstConversation, true))).status, 200);
    assert.equal(await getMarketplaceSearchState(firstKey), null);
    assert.deepEqual(await getMarketplaceSearchState(secondKey), beforeReset);
  });
}

test('malformed conversation identifiers are rejected before model calls or resetting another namespace', async t => {
  let calls = 0;
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { calls++; return null; });
  assert.equal((await POST(request('bad/id'))).status, 400);
  assert.equal((await resetChat(request('bad/id', true))).status, 400);
  assert.equal(calls, 0);
});

test('a stale tab cannot reset the newly authenticated account search state', async () => {
  const key = getChatSearchOwnerKey(session, request(firstConversation), firstConversation);
  await updateMarketplaceSearchState(key, parseExplicitMarketplaceSearchIntent('هاتف'));
  const before = await getMarketplaceSearchState(key);
  const response = await resetChat(new Request('http://localhost/api/chat/reset', { method: 'POST', headers: {
    cookie: createSessionCookie(user), 'x-chat-conversation-id': firstConversation, 'x-chat-owner-id': 'previous-account',
  } }));
  assert.equal(response.status, 409);
  assert.deepEqual(await getMarketplaceSearchState(key), before);
});

test('the real chat route scopes searches, refinements and realtime notifications to the current conversation', async t => {
  const analysis = textAnalysis({ intent: 'search_listing' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  let toolInput: object = {};
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    const checker = body.messages.some((message: { content: unknown }) => typeof message.content === 'string' && message.content.includes('output Scope Checker'));
    const tool = !checker && !body.messages.some((message: { role: string }) => message.role === 'tool');
    return Response.json({ id: 'isolated-search', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant',
        content: checker ? JSON.stringify({ decision: 'ALLOW', confidence: 1, reason_code: 'verified' }) : tool ? null : 'هذه نتائج البحث المتاحة.',
        ...(tool ? { tool_calls: [{ id: 'isolated-search-call', type: 'function', function: { name: 'searchMarketplaceListings', arguments: JSON.stringify(toolInput) } }] } : {}),
      } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  for (const [conversation, input] of [
    [firstConversation, { query: 'هاتف', understoodIntent: { city: 'Riyadh' } }],
    [secondConversation, { query: 'سيارة', understoodIntent: { city: 'Jeddah' } }],
    [firstConversation, { understoodIntent: { searchMode: 'refine', maxPrice: 200 } }],
  ] as const) {
    toolInput = input;
    const response = await POST(request(conversation));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /tool-output-available/);
  }
  const firstKey = getChatSearchOwnerKey(session, request(firstConversation), firstConversation);
  const secondKey = getChatSearchOwnerKey(session, request(secondConversation), secondConversation);
  assert.equal((await getMarketplaceSearchState(firstKey))?.city, 'Riyadh');
  assert.equal((await getMarketplaceSearchState(firstKey))?.maxPrice, 200);
  assert.equal((await getMarketplaceSearchState(secondKey))?.city, 'Jeddah');
  const events = getRealtimeEventsSince(null, { userId: user.id, isAdmin: false }).filter(event => event.type === 'ai_results_updated');
  assert.ok(events.some(event => 'ownerKey' in event.payload && event.payload.ownerKey === firstKey));
  assert.ok(events.some(event => 'ownerKey' in event.payload && event.payload.ownerKey === secondKey));
  assert.equal(getRealtimeEventsSince(null, { userId: 'another-account', isAdmin: false }).filter(event => event.type === 'ai_results_updated').length, 0);
});
