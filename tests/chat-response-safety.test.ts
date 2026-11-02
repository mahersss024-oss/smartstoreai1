import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSafeAssistantText,
  isRawServiceErrorResponse,
} from '@/lib/chat-response-safety';
import { normalizeInternalChatHref } from '@/lib/chat/internal-links';

test('detects raw Render 502 HTML responses', () => {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head><title>502</title></head>
  <body><h1>Bad Gateway</h1><div>This service is currently unavailable.</div></body>
</html>`;

  assert.equal(isRawServiceErrorResponse(html), true);
  assert.equal(getSafeAssistantText(html), '');
});

test('keeps normal assistant text', () => {
  const text = 'تمت مراجعة الصورة، ويبدو أن المنتج مطابق لوصف الإعلان.';

  assert.equal(isRawServiceErrorResponse(text), false);
  assert.equal(getSafeAssistantText(`  ${text}  `), text);
});

test('assistant prose uses the service description rather than model-provider names', () => {
  for (const name of ['DeepSeek', 'deepseek', 'DEEP SEEK', 'Deep-Seek', 'ديب سيك', 'ديبسيك', 'ديب-سيك']) {
    assert.equal(getSafeAssistantText(`تتم المعالجة عبر ${name}.`), 'تتم المعالجة عبر خدمة الذكاء الاصطناعي.');
  }
  assert.equal(getSafeAssistantText('أنا حمد، مساعدك في سوق حمد.'), 'أنا حمد، مساعدك في سوق حمد.');
});

test('attached Arabic prepositions remain grammatical without exposing a model name', () => {
  assert.equal(getSafeAssistantText('تتم المعالجة بديب سيك.'), 'تتم المعالجة بخدمة الذكاء الاصطناعي.');
  assert.equal(getSafeAssistantText('يرسل الطلب لديبسيك.'), 'يرسل الطلب لخدمة الذكاء الاصطناعي.');
  assert.equal(getSafeAssistantText('يرسل الطلب لـديب سيك.'), 'يرسل الطلب لـخدمة الذكاء الاصطناعي.');
});

test('model-name neutralization preserves functional link destinations and normal Arabic words', () => {
  assert.equal(
    getSafeAssistantText('راجع [التفاصيل](https://souqhamad.com/listings/deepseek-item?source=deepseek).'),
    'راجع [التفاصيل](/listings/deepseek-item?source=deepseek).',
  );
  assert.equal(
    getSafeAssistantText('راجع [DeepSeek](/listings/deepseek-item).'),
    'راجع [خدمة الذكاء الاصطناعي](/listings/deepseek-item).',
  );
  assert.equal(getSafeAssistantText('يمكنك اختيار ديبسيكستان من بياناتك.'), 'يمكنك اختيار ديبسيكستان من بياناتك.');
});

test('same-site page links become relative and external URLs are rejected', () => {
  const text = 'راجع [إعلاناتي](https://www.souqhamad.com/account/listings?tab=draft).';
  assert.equal(getSafeAssistantText(text), 'راجع [إعلاناتي](/account/listings?tab=draft).');
  assert.equal(normalizeInternalChatHref('https://souqhamad.com/commission-policy'), '/commission-policy');
  assert.equal(normalizeInternalChatHref('https://outside.example/account/listings'), null);
  assert.equal(normalizeInternalChatHref('https://souqhamad.com//outside.example'), null);
  assert.equal(normalizeInternalChatHref('//outside.example/account/listings'), null);
  assert.equal(normalizeInternalChatHref('javascript:alert(1)'), null);
});

test('chat markdown renders only normalized same-site destinations as links', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'components', 'chat-elements', 'message.tsx'), 'utf8');

  assert.match(source, /normalizeInternalChatHref\(href\)/);
  assert.match(source, /<Link[\s\S]*?href=\{internalPath\}/);
  assert.match(source, /<span className="font-semibold text-blue-700 underline/);
  assert.doesNotMatch(source, /target="_blank"/);
});
