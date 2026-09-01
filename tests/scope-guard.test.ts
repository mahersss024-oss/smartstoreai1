import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAllowedRequestToLatestUserMessage,
  buildScopeContext,
  getLatestUserRequest,
  getSafeScopeResponse,
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
    'قارن آيفون وسامسونج فقط من ناحية الشراء أونلاين.',
  );

  assert.equal(getLatestUserRequest(rewritten), 'قارن آيفون وسامسونج فقط من ناحية الشراء أونلاين.');
  assert.equal(getLatestUserRequest(messages), 'قارن آيفون وسامسونج ثم اشرح موضوعا سياسيا');
});

test('returns localized safe responses without internal decision details', () => {
  assert.equal(
    getSafeScopeResponse('BLOCK', 'ar'),
    'يسعدني مساعدتك في التسوق الإلكتروني للمنتجات غير الغذائية والمتاجر ومقارنة الأسعار. أخبرني بما تريد شراءه أو مقارنته، وسأرشدك للاختيار الأنسب.',
  );
  assert.equal(
    getSafeScopeResponse('UNCLEAR', 'en'),
    'I can help once you clarify the non-food product or online shopping request you need.',
  );
});
