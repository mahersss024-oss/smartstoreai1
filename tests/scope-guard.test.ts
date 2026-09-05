import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAllowedRequestToLatestUserMessage,
  buildScopeContext,
  getLatestUserRequest,
  getMarketplaceContinuationScopeDecision,
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

test('allows short marketplace search follow-ups from prior context', () => {
  const context = buildScopeContext([
    { role: 'user', parts: [{ type: 'text', text: 'أبحث عن سيارة في الرياض' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'ما نوع السيارة؟' }] },
    { role: 'user', parts: [{ type: 'text', text: 'تايوتا كامري' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'ما سنة الصنع؟' }] },
    { role: 'user', parts: [{ type: 'text', text: '2020' }] },
  ]);

  const decision = getMarketplaceContinuationScopeDecision('2020', context);

  assert.equal(decision?.decision, 'ALLOW');
  assert.equal(decision?.reason_code, 'marketplace_context_follow_up');
});

test('allows buyer budget follow-ups from prior marketplace context', () => {
  const context = buildScopeContext([
    { role: 'user', parts: [{ type: 'text', text: 'أبحث عن سيارة في الرياض' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'ما نوع السيارة؟' }] },
    { role: 'user', parts: [{ type: 'text', text: 'ميزانيتي 50 ألف' }] },
  ]);

  const decision = getMarketplaceContinuationScopeDecision(
    'ميزانيتي 50 ألف',
    context,
  );

  assert.equal(decision?.decision, 'ALLOW');
  assert.equal(decision?.reason_code, 'marketplace_context_follow_up');
});

test('does not allow unrelated short follow-ups through marketplace context', () => {
  const context = buildScopeContext([
    { role: 'user', parts: [{ type: 'text', text: 'أبحث عن سيارة في الرياض' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'ما نوع السيارة؟' }] },
    { role: 'user', parts: [{ type: 'text', text: 'اخبار سياسية' }] },
  ]);

  const decision = getMarketplaceContinuationScopeDecision('اخبار سياسية', context);

  assert.equal(decision, null);
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
    'أنا هنا لمساعدتك في سوق SmartStore AI: البحث عن الإعلانات، إنشاء إعلان، إدارة منتجاتك، المحادثة الداخلية، البلاغات، والإرشاد للمنتجات المسموحة.',
  );
  assert.equal(
    getSafeScopeResponse('UNCLEAR', 'en'),
    'I can help once you clarify the marketplace product, listing, buyer search, or seller action you need.',
  );
});
