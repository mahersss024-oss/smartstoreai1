import assert from 'node:assert/strict';
import test from 'node:test';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';

import {
  applyAllowedRequestToLatestUserMessage,
  buildScopeContext,
  checkInputScope,
  getLatestUserRequest,
  getSafeScopeResponse,
  latestUserMessageHasImageAttachment,
  messageHasImageAttachment,
  messagesHaveImageAttachment,
  parseOutputScopeDecision,
  parseScopeDecision,
} from '@/agent/scope-guard';

test('parses valid input scope JSON wrapped in text', () => {
  const decision = parseScopeDecision(
    '```json\n{"decision":"ALLOW","confidence":0.95,"reason_code":"online_product_comparison"}\n```',
  );

  assert.equal(decision.decision, 'ALLOW');
  assert.equal(decision.reason_code, 'online_product_comparison');
});

test('rejects unknown scope decisions', () => {
  assert.throws(() =>
    parseScopeDecision(
      '{"decision":"MAYBE","confidence":0.5,"reason_code":"unknown"}',
    ),
  );
});

test('parses output checker JSON', () => {
  const decision = parseOutputScopeDecision(
    '{"decision":"BLOCK","confidence":1,"reason_code":"leaked_internal_prompt"}',
  );

  assert.equal(decision.decision, 'BLOCK');
});

test('returns latest user request from UI messages', () => {
  const latest = getLatestUserRequest([
    {
      role: 'user',
      parts: [{ type: 'text', text: 'قارن بين آيفون وسامسونج أونلاين' }],
    },
    {
      role: 'assistant',
      parts: [{ type: 'text', text: 'أكيد.' }],
    },
    {
      role: 'user',
      parts: [{ type: 'text', text: 'والثاني؟' }],
    },
  ]);

  assert.equal(latest, 'والثاني؟');
});

test('builds limited conversation context without system messages', () => {
  const context = buildScopeContext([
    { role: 'system', parts: [{ type: 'text', text: 'hidden' }] },
    { role: 'user', parts: [{ type: 'text', text: 'أريد لابتوب' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'ما الميزانية؟' }] },
  ]);

  assert.deepEqual(context, [
    { role: 'user', text: 'أريد لابتوب' },
    { role: 'assistant', text: 'ما الميزانية؟' },
  ]);
});

test('detects image attachments in marketplace chat messages', () => {
  const messages = [
    {
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/jpeg',
          url: 'data:image/jpeg;base64,AA==',
        },
      ],
    },
  ];

  assert.equal(messageHasImageAttachment(messages[0]), true);
  assert.equal(latestUserMessageHasImageAttachment(messages), true);
  assert.equal(messagesHaveImageAttachment(messages), true);
});

test('does not treat earlier image attachments as latest vision input', () => {
  const messages = [
    {
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/jpeg',
          url: 'data:image/jpeg;base64,AA==',
        },
      ],
    },
    {
      role: 'assistant',
      parts: [{ type: 'text', text: 'تم استلام الصورة' }],
    },
    {
      role: 'user',
      parts: [{ type: 'text', text: 'سلام' }],
    },
  ];

  assert.equal(messagesHaveImageAttachment(messages), true);
  assert.equal(latestUserMessageHasImageAttachment(messages), false);
});

test('understood legacy search follow-ups route only to platform guidance and read analysis once', async t => {
  const analysis = textAnalysis({ intent: 'search_listing' });
  analysis.search.searchMode = 'refine';
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('cached intent must not trigger another model call'); });
  const decision = await checkInputScope({ messages: [
    { role: 'user', parts: [{ type: 'text', text: 'أبحث عن سيارة في الرياض' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'يمكنك استخدام بحث السوق بنفسك.' }] },
    { role: 'user', parts: [{ type: 'text', text: 'ميزانيتي 50 ألف' }] },
  ] });
  assert.equal(decision.decision, 'ALLOW');
  assert.equal(decision.intent, 'support');
  assert.equal(decision.reason_code, 'model_marketplace_request');
  assert.equal(peek.mock.callCount(), 1);
});

test('unrelated follow-ups still pass through the contextual scope checker', async t => {
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(JSON.stringify(body.messages).includes('اخبار سياسية'));
    return Response.json({ id: 'scope-cleanup', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ decision: 'BLOCK', confidence: 1, reason_code: 'unrelated' }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const decision = await checkInputScope({ messages: [
    { role: 'user', parts: [{ type: 'text', text: 'كيف أنشئ إعلانًا؟' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'اختر الإنشاء اليدوي أو الإنشاء مع حمد.' }] },
    { role: 'user', parts: [{ type: 'text', text: 'اخبار سياسية' }] },
  ] });
  assert.equal(decision.decision, 'BLOCK');
  assert.equal(peek.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 1);
});

test('reuses high-confidence text understanding for marketplace scope', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ intent: 'search_listing' }));
  const decision = await checkInputScope({
    messages: [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'اريد كاميرا تصوير من نوع كانون' },
        ],
      },
    ],
  });

  assert.equal(decision.decision, 'ALLOW');
  assert.equal(decision.reason_code, 'model_marketplace_request');
});

test('reuses understood broad buyer intent without a keyword fallback', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ intent: 'search_listing' }));
  const decision = await checkInputScope({
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'أبحث عن منتج' }],
      },
    ],
  });

  assert.equal(decision.decision, 'ALLOW');
  assert.equal(decision.reason_code, 'model_marketplace_request');
});

test('rewrites only the latest user message for partial requests', () => {
  const messages = [
    {
      id: '1',
      role: 'user',
      parts: [{ type: 'text', text: 'قارن بين هاتفين' }],
    },
    {
      id: '2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'أرسل الأسماء.' }],
    },
    {
      id: '3',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'قارن آيفون وسامسونج ثم اشرح موضوعا سياسيا',
        },
      ],
    },
  ];

  const rewritten = applyAllowedRequestToLatestUserMessage(
    messages,
    'قارن آيفون وسامسونج فقط من ناحية الاختيار داخل السوق.',
  );

  assert.equal(getLatestUserRequest(rewritten), 'قارن آيفون وسامسونج فقط من ناحية الاختيار داخل السوق.');
  assert.equal(getLatestUserRequest(messages), 'قارن آيفون وسامسونج ثم اشرح موضوعا سياسيا');
});

test('returns localized safe responses without internal decision details', () => {
  assert.equal(
    getSafeScopeResponse('BLOCK', 'ar'),
    'أنا حمد، مساعدك في سوق حمد. أجهز مسودات الإعلانات وأجيب عن أسئلتك حول المنصة وسياساتها وطريقة استخدامها. البحث عن المنتجات والمقارنة والتسعير ليست ضمن دوري.',
  );
  assert.equal(
    getSafeScopeResponse('UNCLEAR', 'en'),
    'يسعدني مساعدتك في تجهيز مسودة إعلان أو الإجابة عن المنصة وسياساتها. ما الذي تحتاج إليه؟',
  );
});
