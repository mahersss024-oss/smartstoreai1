import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '@/app/api/chat/route';

test('requires Google sign-in before any chat model interaction', async () => {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'message-1',
            role: 'user',
            parts: [{ type: 'text', text: 'ابحث عن سيارة في الرياض' }],
          },
        ],
        locationSettings: { language: 'ar' },
      }),
    }),
  );

  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /\[\[SMARTSTORE_GOOGLE_AUTH_REQUIRED\]\]/);
});
