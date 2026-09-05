import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  createImageComplianceUserMessage,
  parseImageComplianceDecision,
} from '@/agent/marketplace/vision-compliance';

test('parses image compliance block JSON', () => {
  const decision = parseImageComplianceDecision(`text before
{
  "decision": "block",
  "confidence": 0.92,
  "reasons": ["visible alcohol bottle"],
  "prohibited_category": "alcohol",
  "detected_product": "whisky bottle",
  "sharia_sensitive": true
}
text after`);

  assert.equal(decision.decision, 'block');
  assert.equal(decision.confidence, 0.92);
  assert.equal(decision.prohibitedCategory, 'alcohol');
  assert.equal(decision.detectedProduct, 'whisky bottle');
  assert.equal(decision.shariaSensitive, true);
});

test('routes category mismatches to manual review', () => {
  const decision = parseImageComplianceDecision(`{
  "decision": "allow",
  "confidence": 0.9,
  "reasons": ["visible product is a laptop"],
  "detected_category": "computers",
  "expected_category": "mobile_phones",
  "category_match": "mismatch",
  "detected_product": "laptop",
  "sharia_sensitive": false
}`);

  assert.equal(decision.decision, 'needs_review');
  assert.equal(decision.detectedCategory, 'computers');
  assert.equal(decision.expectedCategory, 'mobile_phones');
  assert.equal(decision.categoryMatch, 'mismatch');
  assert.deepEqual(decision.reasons, [
    'visible product is a laptop',
    'image_category_mismatch',
  ]);
});

test('accepts verbose vision reasons and empty optional categories', () => {
  const decision = parseImageComplianceDecision(`{
  "decision": "allow",
  "confidence": 0.88,
  "reasons": ["The image appears to show an ordinary passenger car in a showroom or parking area, with no visible prohibited item, and the visible product is consistent with a regular marketplace vehicle listing for buyer or seller assistance."],
  "prohibited_category": "",
  "detected_category": "cars",
  "expected_category": "cars",
  "category_match": "match",
  "detected_product": "white sedan",
  "sharia_sensitive": false
}`);

  assert.equal(decision.decision, 'allow');
  assert.equal(decision.prohibitedCategory, undefined);
  assert.equal(decision.detectedCategory, 'cars');
  assert.equal(decision.categoryMatch, 'match');
  assert.ok(decision.reasons[0].length <= 180);
});

test('keeps weapon-like toys in review decisions from vision', () => {
  const decision = parseImageComplianceDecision(`{
  "decision": "needs_review",
  "confidence": 0.82,
  "reasons": ["visible item appears to be a bead gun, not confirmed firearm"],
  "prohibited_category": "weapon_lookalike_or_airsoft",
  "detected_category": "gaming_hobbies",
  "expected_category": "kids",
  "category_match": "unclear",
  "detected_product": "bead gun",
  "sharia_sensitive": false
}`);

  assert.equal(decision.decision, 'needs_review');
  assert.equal(decision.prohibitedCategory, 'weapon_lookalike_or_airsoft');
  assert.equal(decision.detectedProduct, 'bead gun');
});

test('infers expected marketplace categories from user text', async () => {
  const { inferExpectedMarketplaceCategory } = await import(
    '@/agent/marketplace/vision-compliance'
  );

  assert.equal(
    inferExpectedMarketplaceCategory('أريد بيع آيفون 14 برو'),
    'mobile_phones',
  );
  assert.equal(
    inferExpectedMarketplaceCategory('كامري 2020 في الرياض'),
    'cars',
  );
});

test('creates a vision compliance message from the latest user image', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'صورة قديمة بدون أهمية' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([1]),
        },
      ],
    },
    {
      role: 'assistant',
      content: 'تم',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'هل هذا المنتج مسموح؟' },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: new Uint8Array([2]),
        },
      ],
    },
  ];

  const message = createImageComplianceUserMessage({
    messages,
    userRequest: 'افحص المنتج',
    language: 'ar',
  });

  assert.ok(message);
  assert.equal(message.role, 'user');
  assert.ok(Array.isArray(message.content));

  const content = Array.isArray(message.content) ? message.content : [];
  assert.equal(content.length, 2);
  assert.deepEqual((content[1] as { data: Uint8Array }).data, new Uint8Array([2]));
});
