import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '@/app/api/chat/route';
import { createSessionCookie } from '@/lib/auth/session';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { createListingDraft, publishListing, listSellerListings } from '@/agent/marketplace/store';
import { textAnalysis } from './helpers/text-understanding';

function completion(content: string | null, tool?: { name: string; arguments: string }) {
  return Response.json({ id: 'customer-flow', object: 'chat.completion', created: 1, model: 'test-model',
    choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: {
      role: 'assistant', content, ...(tool ? { tool_calls: [{ id: 'verified-operation', type: 'function', function: tool }] } : {}),
    } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function request(userId: string, turnId: string) {
  return new Request('http://localhost/api/chat', { method: 'POST', headers: {
    'content-type': 'application/json', cookie: createSessionCookie({ id: userId, email: `${userId}@example.test` }),
  }, body: JSON.stringify({ messages: [{ id: turnId, role: 'user', parts: [{ type: 'text', text: '\u0647\u0627\u062a\u0641' }] }] }) });
}

test('a stale browser chat cannot send one account history into a different authenticated account', async t => {
  let calls = 0;
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { calls++; return null; });
  const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', headers: {
    'content-type': 'application/json', cookie: createSessionCookie({ id: 'current-owner', email: 'current@example.test' }),
  }, body: JSON.stringify({ chatOwnerId: 'previous-owner', messages: [{ id: 'private-turn', role: 'user', parts: [{ type: 'text', text: 'private history' }] }] }) }));
  assert.equal(response.status, 409);
  assert.equal(calls, 0);
});

for (const scenario of ['arabic_rewrite', 'output_check_outage'] as const) {
  test(`real chat preserves database results through ${scenario}`, async t => {
    const analysis = textAnalysis({ intent: 'search_listing' });
    t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
    const listing = createListingDraft({ sellerId: `flow-seller-${scenario}`, category: 'other', title: '\u0647\u0627\u062a\u0641 \u0644\u0644\u0628\u064a\u0639', price: 123 });
    publishListing(listing.id);
    let searches = 0;
    let rewrites = 0;
    t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      assert.ok(String(url).startsWith('https://api.deepseek.com/'), 'all provider requests must be intercepted');
      const body = JSON.parse(String(init?.body));
      const instructions = body.messages.filter((message: { role: string }) => message.role === 'system').map((message: { content: string }) => message.content).join('\n');
      if (instructions.includes('output Scope Checker')) return scenario === 'output_check_outage'
        ? Response.json({ error: { message: 'test checker unavailable' } }, { status: 401 })
        : completion(JSON.stringify({ decision: 'ALLOW', confidence: 1, reason_code: 'verified' }));
      if (instructions.includes('Regenerate the answer')) {
        rewrites++;
        assert.ok(!body.tools?.length, 'rewriting may not execute tools');
        return completion('\u0647\u0630\u0647 \u0646\u062a\u0627\u0626\u062c \u0627\u0644\u0628\u062d\u062b \u0627\u0644\u0645\u062a\u0627\u062d\u0629.');
      }
      if (body.messages.some((message: { role: string }) => message.role === 'tool')) return completion(scenario === 'arabic_rewrite'
        ? '\u0647\u0630\u0647 \u0646\u062a\u0627\u0626\u062c iPhone'
        : '\u0647\u0630\u0647 \u0646\u062a\u0627\u0626\u062c \u0627\u0644\u0628\u062d\u062b.');
      searches++;
      return completion(null, { name: 'searchMarketplaceListings', arguments: JSON.stringify({ query: '\u0647\u0627\u062a\u0641', understoodIntent: { searchMode: 'new_search' } }) });
    });
    const response = await POST(request(`flow-buyer-${scenario}`, `turn-${scenario}`));
    assert.equal(response.status, 200);
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
    const result = events.find(event => event.type === 'tool-output-available');
    assert.ok(result?.output.listings.some((item: { id: string }) => item.id === listing.id));
    const visibleText = events.filter(event => event.type === 'text-delta').map(event => event.delta).join('');
    assert.ok(visibleText);
    assert.doesNotMatch(visibleText, /iPhone|test checker|unavailable/);
    assert.equal(searches, 1);
    assert.equal(rewrites, scenario === 'arabic_rewrite' ? 1 : 0);
  });
}

test('a provider failure after draft creation reports the saved draft and a replay cannot duplicate it', async t => {
  const analysis = textAnalysis({ intent: 'create_listing' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    if (body.messages.some((message: { role: string }) => message.role === 'tool')) return Response.json({ error: { message: 'test response failed after save' } }, { status: 401 });
    return completion(null, { name: 'createListingDraft', arguments: JSON.stringify({ category: 'other', title: '\u0647\u0627\u062a\u0641 \u0644\u0644\u0628\u064a\u0639' }) });
  });
  const userId = 'flow-replay-owner';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await POST(request(userId, 'same-customer-turn'));
    const stream = await response.text();
    assert.match(stream, /\u062d\u064f\u0641\u0638\u062a/);
    assert.equal(listSellerListings(userId).length, 1);
  }
});

test('the real route bounds long conversation history while preserving the latest customer turn and input limits', async t => {
  const analysis = textAnalysis({ intent: 'support' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  const providerBodies: { messages: { role: string; content: unknown }[] }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    providerBodies.push(body);
    const checker = body.messages.some((message: { content: unknown }) => typeof message.content === 'string' && message.content.includes('output Scope Checker'));
    return completion(checker ? JSON.stringify({ decision: 'ALLOW', confidence: 1, reason_code: 'verified' }) : '\u062a\u0645\u062a \u0645\u062a\u0627\u0628\u0639\u0629 \u0637\u0644\u0628\u0643 \u0641\u064a \u0627\u0644\u0633\u0648\u0642.');
  });
  const messages = Array.from({ length: 61 }, (_, index) => ({ id: `history-${index}`, role: index % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `\u0637\u0644\u0628 ${index}` }] }));
  const makeRequest = () => new Request('http://localhost/api/chat', { method: 'POST', headers: {
    'content-type': 'application/json', cookie: createSessionCookie({ id: 'long-chat-owner', email: 'long-chat@example.test' }),
  }, body: JSON.stringify({ messages }) });
  const response = await POST(makeRequest());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /text-delta/);
  const generation = providerBodies.find(body => body.messages.some(message => String(message.content).includes('\u0637\u0644\u0628 60')));
  assert.ok(generation);
  assert.ok(generation.messages.filter(message => message.role !== 'system').length <= 40);
  const beforeOversized = providerBodies.length;
  messages.at(-1)!.parts[0].text = 'x'.repeat(24_001);
  assert.equal((await POST(makeRequest())).status, 413);
  assert.equal(providerBodies.length, beforeOversized);
});

test('verified database cards arrive before output review but generated text waits for approval', { timeout: 10_000 }, async t => {
  const analysis = textAnalysis({ intent: 'search_listing' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  const listing = createListingDraft({ sellerId: 'early-results-seller', category: 'other', title: '\u0647\u0627\u062a\u0641', price: 100 });
  publishListing(listing.id);
  let releaseReview!: () => void;
  const reviewGate = new Promise<void>(resolve => { releaseReview = resolve; });
  t.after(() => releaseReview());
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    if (body.messages.some((message: { content: unknown }) => typeof message.content === 'string' && message.content.includes('output Scope Checker'))) {
      await reviewGate;
      return completion(JSON.stringify({ decision: 'ALLOW', confidence: 1, reason_code: 'verified' }));
    }
    if (body.messages.some((message: { role: string }) => message.role === 'tool')) return completion('\u0647\u0630\u0647 \u0646\u062a\u0627\u0626\u062c \u0627\u0644\u0628\u062d\u062b.');
    return completion(null, { name: 'searchMarketplaceListings', arguments: JSON.stringify({ query: '\u0647\u0627\u062a\u0641' }) });
  });
  const response = await POST(request('early-results-owner', 'early-results-turn'));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('tool-output-available')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    received += decoder.decode(chunk.value, { stream: true });
  }
  assert.ok(received.includes(listing.id));
  assert.ok(!received.includes('text-delta'), 'unreviewed generated prose must not be streamed');
  releaseReview();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value, { stream: true });
  }
  assert.ok(received.includes('text-delta'));
  assert.equal((received.match(/tool-output-available/g) ?? []).length, 1, 'the same tool result is not emitted again after review');
});
