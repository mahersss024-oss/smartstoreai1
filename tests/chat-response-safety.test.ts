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
