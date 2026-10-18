import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appCopy } from '@/app/i18n';
import { customerLanguageInstructions, getArabicCustomerMessage, isArabicCustomerText, resolveCustomerLanguage } from '@/lib/customer-language';
import { getSafeAssistantText } from '@/lib/chat-response-safety';
import { getAuthRequiredResponse, getComplianceBlockResponse, getComplianceReviewResponse } from '@/agent/marketplace/policy';
import { getSafeScopeResponse } from '@/agent/scope-guard';

test('Arabic is used even for old English preferences or another requested locale', () => {
  for (const value of ['ar', 'en', 'fr', 'zh', undefined, null, { language: 'en' }]) {
    assert.equal(resolveCustomerLanguage(value), 'ar');
  }
  assert.equal(appCopy.ar, appCopy.en);
  assert.equal(appCopy.en.direction, 'rtl');
  const check = (value: unknown) => {
    if (typeof value === 'string') assert.ok(isArabicCustomerText(value), value);
    else if (value && typeof value === 'object') Object.values(value).forEach(check);
  };
  // Direction is an HTML attribute, not displayed text.
  const { direction, ...copy } = appCopy.ar;
  assert.equal(direction, 'rtl');
  check(copy);
});

test('foreign-language prose is not displayed even in a mixed-language assistant reply', () => {
  for (const text of ['Hello, how can I help?', 'تم الحفظ. Please continue.', 'Bonjour', '你好', 'المنتج iPhone متوفر']) {
    assert.equal(isArabicCustomerText(text), false, text);
    assert.equal(getSafeAssistantText(text), '', text);
  }
  assert.equal(getSafeAssistantText('تم تجهيز مسودة إعلانك.'), 'تم تجهيز مسودة إعلانك.');
  assert.ok(customerLanguageInstructions.includes('Arabic only'));
});

test('Arabic replies preserve functional links and authentication protocol markers', () => {
  for (const text of [
    'افتح [الإعلان](/listings/example-id?source=chat).',
    'راجع [التفاصيل](https://souqhamad.com/listings/example-id).',
    '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]] يرجى تسجيل الدخول.',
  ]) assert.equal(getSafeAssistantText(text), text);
  assert.equal(getSafeAssistantText('[Open listing](https://souqhamad.com/listings/example-id)'), '');
});

test('raw English API errors use Arabic fallback without translating stored listing data', () => {
  const fallback = 'تعذر إكمال الإجراء الآن.';
  for (const value of ['listing_not_found', 'Network error', 'تم الحفظ. Error', undefined, null]) {
    assert.equal(getArabicCustomerMessage(value, fallback), fallback);
  }
  assert.equal(getArabicCustomerMessage('  لا يمكن نشر الإعلان الآن.  ', fallback), 'لا يمكن نشر الإعلان الآن.');
  assert.equal(getArabicCustomerMessage(undefined, ''), '');
});

test('static auth policy and scope replies remain Arabic for all accepted language arguments', () => {
  for (const response of [getAuthRequiredResponse, getComplianceBlockResponse, getComplianceReviewResponse]) {
    assert.equal(response('en'), response('ar'));
    assert.ok(isArabicCustomerText(response('en')));
  }
  for (const decision of ['ALLOW', 'BLOCK', 'UNCLEAR', 'OUTPUT_BLOCK'] as const) {
    assert.equal(getSafeScopeResponse(decision, 'en'), getSafeScopeResponse(decision, 'ar'));
    assert.ok(isArabicCustomerText(getSafeScopeResponse(decision, 'en')));
  }
});

test('missing-photo illustrations contain Arabic rather than embedded English text', () => {
  for (const path of ['app/favorites/page.tsx', 'app/conversations/[conversationId]/page.tsx', 'app/listings/[listingId]/page.tsx']) {
    const source = readFileSync(path, 'utf8');
    const image = source.match(/'data:image\/svg\+xml,([^']+)'/);
    assert.ok(image, path);
    const svg = decodeURIComponent(image[1]);
    assert.match(svg, />لا توجد صورة<\/text>/);
    assert.doesNotMatch(svg, /No real photo/);
  }
});

test('server and client guard generated replies but do not rewrite customer message parts', () => {
  const route = readFileSync('app/api/chat/route.ts', 'utf8');
  const page = readFileSync('app/page.tsx', 'utf8');
  const agent = readFileSync('agent/chat-agent.ts', 'utf8');
  assert.match(route, /return resolveCustomerLanguage\(settings\?\.language\)/);
  assert.match(route, /text = getSafeAssistantText\(text\)/);
  assert.match(agent, /customerLanguageInstructions/);
  assert.match(page, /renderMessageParts\(message.parts, chatListingCardsById, true\)/);
  assert.match(page, /assistant \? getSafeAssistantText\(part.text\)/);
  assert.match(page, /renderMessageParts\(userContentParts, chatListingCardsById\)/);
});
