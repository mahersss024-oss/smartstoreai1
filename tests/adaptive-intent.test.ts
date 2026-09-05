import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFallbackAdaptiveMarketplaceIntent,
  parseAdaptiveMarketplaceIntent,
} from '@/agent/marketplace/adaptive-intent';

test('parses adaptive marketplace intent JSON', () => {
  const intent = parseAdaptiveMarketplaceIntent(
    '{"intent":"search_listing","execution":"search_listings","confidence":0.93,"reasonCode":"buyer_search","searchQuery":"كامري 2020 الرياض","requiresAuth":false,"requiresConfirmation":false}',
  );

  assert.equal(intent.intent, 'search_listing');
  assert.equal(intent.execution, 'search_listings');
  assert.equal(intent.searchQuery, 'كامري 2020 الرياض');
});

test('parses adaptive marketplace intent JSON with snake case fields', () => {
  const intent = parseAdaptiveMarketplaceIntent(
    '{"intent":"general_info","execution":"analyze_images","confidence":0.91,"reason_code":"marketplace_image_upload","normalized_request":"افحص الصورة","requires_auth":false,"requires_confirmation":false}',
  );

  assert.equal(intent.intent, 'general_info');
  assert.equal(intent.execution, 'analyze_images');
  assert.equal(intent.reasonCode, 'marketplace_image_upload');
  assert.equal(intent.normalizedRequest, 'افحص الصورة');
});

test('uses conversation context for short marketplace follow-ups', () => {
  const intent = getFallbackAdaptiveMarketplaceIntent([
    { role: 'user', parts: [{ type: 'text', text: 'أبحث عن سيارة في الرياض' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'أي ماركة؟' }] },
    { role: 'user', parts: [{ type: 'text', text: 'تايوتا كامري' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'أي سنة؟' }] },
    { role: 'user', parts: [{ type: 'text', text: '2020' }] },
  ]);

  assert.equal(intent.intent, 'search_listing');
  assert.equal(intent.execution, 'search_listings');
  assert.match(intent.searchQuery ?? '', /سيارة/);
  assert.match(intent.searchQuery ?? '', /كامري/);
  assert.match(intent.searchQuery ?? '', /2020/);
  assert.equal(intent.requiresAuth, false);
});

test('routes seller listing requests to authenticated draft creation', () => {
  const intent = getFallbackAdaptiveMarketplaceIntent([
    { role: 'user', parts: [{ type: 'text', text: 'عندي آيفون 14 برو للبيع' }] },
  ]);

  assert.equal(intent.intent, 'create_listing');
  assert.equal(intent.execution, 'create_listing_draft');
  assert.equal(intent.requiresAuth, true);
  assert.equal(intent.requiresConfirmation, true);
});

test('routes image-only messages to listing image analysis', () => {
  const intent = getFallbackAdaptiveMarketplaceIntent([
    {
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AA==',
        },
      ],
    },
  ]);

  assert.equal(intent.execution, 'analyze_images');
  assert.equal(intent.reasonCode, 'marketplace_image_upload');
  assert.equal(intent.requiresAuth, false);
});
