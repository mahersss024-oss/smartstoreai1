import { POST as chat } from '@/app/api/chat/route';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';
import { aiConsentHeader, aiSharingConsent } from '@/lib/platform/ai-consent';
import { createSignedSession } from '@/lib/auth/session';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { chatGenerationLimits, reserveChatGeneration } from '@/lib/chat/admission';
import { createChatAgent } from '@/agent/chat-agent';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';
import type { AuthSession } from '@/lib/auth/session';

function environment(t: TestContext, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
function session(): AuthSession {
  return { user: { id: randomUUID(), email: 'chat@example.test' }, issuedAt: 1, expiresAt: Math.floor(Date.now()/1000) + 3600 };
}

test('two concurrent chats are admitted atomically, other users are independent, release is idempotent', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_CHAT_MAX_CONCURRENT_PER_USER: '2', SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '0' });
  const user = session();
  const results = await Promise.all(Array.from({ length: 3 }, () => reserveChatGeneration(user)));
  assert.equal(results.filter(result => !result.response).length, 2);
  assert.equal(results[2].response?.status, 429);
  assert.equal((await results[2].response!.json()).error, 'chat_concurrency_limited');
  const other = await reserveChatGeneration(session()); assert.equal(other.response, undefined);
  await results[0].release(); await results[0].release();
  const replacement = await reserveChatGeneration(user); assert.equal(replacement.response, undefined);
  assert.equal((await reserveChatGeneration(user)).response?.status, 429);
  await Promise.all([...results, replacement, other].map(result => result.release()));
});

test('configured daily request ceiling counts accepted work and resets at Saudi midnight', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '1' });
  let now = Date.parse('2026-11-12T20:59:59Z'); t.mock.method(Date, 'now', () => now);
  const user = session(); const first = await reserveChatGeneration(user); await first.release();
  const denied = await reserveChatGeneration(user);
  assert.equal((await denied.response!.json()).error, 'chat_daily_limit_reached');
  assert.equal(denied.response!.headers.get('retry-after'), '1');
  now += 1000; const nextDay = await reserveChatGeneration(user);
  assert.equal(nextDay.response, undefined); await nextDay.release();
});

test('an abandoned lease expires and its late release cannot free a newer generation', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_CHAT_MAX_CONCURRENT_PER_USER: '1', SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '0' });
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const user = session(); const abandoned = await reserveChatGeneration(user);
  now += 10 * 60_000 + 1;
  const recovered = await reserveChatGeneration(user); assert.equal(recovered.response, undefined);
  await abandoned.release();
  assert.equal((await reserveChatGeneration(user)).response?.status, 429);
  await recovered.release();
});

test('database admission fails closed instead of falling back to per-process permits', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'database' });
  mockDatabaseMethod(t, prisma, '$transaction', async () => { throw new Error('database unavailable'); });
  const result = await reserveChatGeneration(session());
  assert.equal(result.response?.status, 503); await result.release();
});

test('daily quota is opt-in, and generation settings reject malformed/unbounded values', t => {
  environment(t, { SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '', SMARTSTORE_CHAT_MAX_STEPS: '900', SMARTSTORE_CHAT_MAX_OUTPUT_TOKENS: 'bad' });
  assert.equal(chatGenerationLimits().dailyRequests, 0);
  assert.equal(chatGenerationLimits().maxSteps, 20);
  assert.equal(chatGenerationLimits().maxOutputTokens, 4096);
});

test('actual agent calls send the configured output cap and stop repeated help tools at the configured step bound', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_CHAT_MAX_STEPS: '2', SMARTSTORE_CHAT_MAX_OUTPUT_TOKENS: '4096' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls++; const body = JSON.parse(String(init?.body)); assert.equal(body.max_tokens, 4096);
    return Response.json({ id: 'bounded-help', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'help-' + calls, type: 'function', function: { name: 'getPlatformHelp', arguments: JSON.stringify({ topic: 'commissions' }) } }],
      } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const result = await createChatAgent(null).generate({ messages: [{ role: 'user', content: 'Explain platform fees' }] });
  assert.equal(calls, 2); assert.equal(result.steps.length, 2);
  assert.ok(result.steps.every(step => step.toolResults.length === 1));
});


test('real chat route keeps both permits during deferred generation and releases them after stream work finishes', { timeout: 10000 }, async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_CHAT_MAX_CONCURRENT_PER_USER: '2', SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT: '0' });
  const analysis = textAnalysis({ intent: 'support' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  let resolveGeneration!: () => void; let started!: () => void; let starts = 0;
  const pending = new Promise<void>(resolve => { resolveGeneration = resolve; });
  const bothStarted = new Promise<void>(resolve => { started = resolve; });
  t.after(resolveGeneration);
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    const instructions = body.messages.filter((message: { role: string }) => message.role === 'system').map((message: { content: string }) => message.content).join('\n');
    let content: string;
    if (instructions.includes('Scope Checker')) content = JSON.stringify({ decision: 'ALLOW', confidence: 1, intent: 'support', reason_code: 'platform_identity' });
    else { starts++; if (starts === 2) started(); await pending; content = '\u0623\u0646\u0627 \u062d\u0645\u062f\u060c \u0645\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0633\u0648\u0642 \u062d\u0645\u062f.'; }
    return Response.json({ id: 'pending-chat', object: 'chat.completion', created: 1, model: 'test-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const user = session();
  const request = () => new Request('http://localhost/api/chat', { method: 'POST', headers: {
    authorization: 'Bearer ' + createSignedSession(user.user), 'content-type': 'application/json', [aiConsentHeader]: aiSharingConsent.version,
  }, body: JSON.stringify({ messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: '\u0645\u0646 \u0623\u0646\u062a\u061f' }] }] }) });
  const responses = await Promise.all([chat(request()), chat(request())]);
  await bothStarted;
  const limited = await chat(request()); assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'chat_concurrency_limited');
  resolveGeneration(); await Promise.all(responses.map(response => response.text()));
  const next = await chat(request()); assert.equal(next.status, 200); await next.text();
});
