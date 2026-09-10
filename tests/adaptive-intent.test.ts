import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFallbackAdaptiveMarketplaceIntent,
  parseAdaptiveMarketplaceIntent,
  resolveAdaptiveMarketplaceIntent,
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

test('parses tolerant adaptive model enum and boolean values', () => {
  const intent = parseAdaptiveMarketplaceIntent(
    '{"intent":"search_listings","execution":"search_listing","confidence":"0.77","reasonCode":"buyer_search","searchQuery":"كاميرا كانون","requiresAuth":"false","requiresConfirmation":"false"}',
  );

  assert.equal(intent.intent, 'search_listing');
  assert.equal(intent.execution, 'search_listings');
  assert.equal(intent.confidence, 0.77);
  assert.equal(intent.searchQuery, 'كاميرا كانون');
  assert.equal(intent.requiresAuth, false);
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

test('routes listing approval follow-ups to draft creation', () => {
  const intent = getFallbackAdaptiveMarketplaceIntent([
    {
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'للنشر، كرسي مكتب مستعمل في تبوك سعره ثابت 30 ريال',
        },
      ],
    },
    {
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: 'معاينة الإعلان: كرسي مكتب، السعر 30 ريال، المدينة تبوك، التصنيف أثاث. هل توافق على النشر؟',
        },
      ],
    },
    { role: 'user', parts: [{ type: 'text', text: 'اعتمد الإعلان' }] },
  ]);

  assert.equal(intent.intent, 'create_listing');
  assert.equal(intent.execution, 'create_listing_draft');
  assert.equal(intent.reasonCode, 'listing_publish_confirmation');
  assert.equal(intent.requiresAuth, true);
});

test('routes a new standalone seller product to a new draft after a prior listing', () => {
  const intent = getFallbackAdaptiveMarketplaceIntent([
    { role: 'user', parts: [{ type: 'text', text: 'عندي آيفون 14 برو للبيع' }] },
    {
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: 'تم إنشاء مسودة إعلان الآيفون. هل تريد نشرها؟',
        },
      ],
    },
    { role: 'user', parts: [{ type: 'text', text: 'سيارة كامري 2020 للبيع السعر 85000 في الرياض ممشى 90 ألف' }] },
  ]);

  assert.equal(intent.intent, 'create_listing');
  assert.equal(intent.execution, 'create_listing_draft');
  assert.equal(intent.requiresAuth, true);
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

test('resolves image uploads without calling the model router', async () => {
  const intent = await resolveAdaptiveMarketplaceIntent({
    messages: [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'افحص الصورة' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,AA==',
          },
        ],
      },
    ],
    language: 'ar',
    session: null,
  });

  assert.equal(intent.execution, 'analyze_images');
  assert.equal(intent.reasonCode, 'marketplace_image_upload');
});
