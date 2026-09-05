import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  aggregateImageComplianceDecisions,
  createImageComplianceUserMessage,
  createImageComplianceUserMessages,
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

test('passes all latest user images to visual compliance', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'افحص صور المنتج' },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: new Uint8Array([10]),
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([20]),
        },
      ],
    },
  ];

  const message = createImageComplianceUserMessage({
    messages,
    userRequest: 'افحص صور المنتج',
    language: 'ar',
  });

  assert.ok(message);
  assert.ok(Array.isArray(message.content));

  const content = Array.isArray(message.content) ? message.content : [];
  const imageParts = content.filter((part) => part.type === 'file');

  assert.equal(imageParts.length, 2);
  assert.deepEqual(
    (imageParts[0] as { data: Uint8Array }).data,
    new Uint8Array([10]),
  );
  assert.deepEqual(
    (imageParts[1] as { data: Uint8Array }).data,
    new Uint8Array([20]),
  );
});

test('splits latest user images into independent visual compliance requests', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'inspect product images' },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: new Uint8Array([10]),
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([20]),
        },
      ],
    },
  ];

  const imageMessages = createImageComplianceUserMessages({
    messages,
    userRequest: 'inspect product images',
    language: 'ar',
  });

  assert.equal(imageMessages.length, 2);

  for (const imageMessage of imageMessages) {
    const content = Array.isArray(imageMessage.content)
      ? imageMessage.content
      : [];

    assert.equal(content.filter((part) => part.type === 'file').length, 1);
  }

  assert.deepEqual(
    ((imageMessages[0].content as Array<{ data?: Uint8Array }>)[1]).data,
    new Uint8Array([10]),
  );
  assert.deepEqual(
    ((imageMessages[1].content as Array<{ data?: Uint8Array }>)[1]).data,
    new Uint8Array([20]),
  );
});

test('aggregates multi-image compliance using the strictest decision', () => {
  const decision = aggregateImageComplianceDecisions([
    {
      decision: 'allow',
      confidence: 0.95,
      reasons: ['ordinary phone'],
      detectedCategory: 'mobile_phones',
      expectedCategory: 'mobile_phones',
      categoryMatch: 'match',
      detectedProduct: 'iphone',
      shariaSensitive: false,
    },
    {
      decision: 'block',
      confidence: 0.9,
      reasons: ['visible real firearm'],
      prohibitedCategory: 'weapons',
      detectedCategory: 'weapons',
      expectedCategory: 'mobile_phones',
      categoryMatch: 'mismatch',
      detectedProduct: 'handgun',
      shariaSensitive: true,
    },
  ]);

  assert.equal(decision.decision, 'block');
  assert.equal(decision.prohibitedCategory, 'weapons');
  assert.equal(decision.detectedCategory, 'multiple');
  assert.equal(decision.categoryMatch, 'mismatch');
  assert.equal(decision.shariaSensitive, true);
  assert.ok(decision.reasons.includes('inspected_2_images'));
});
