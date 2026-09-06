import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSafeAssistantText,
  isRawServiceErrorResponse,
} from '@/lib/chat-response-safety';

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
