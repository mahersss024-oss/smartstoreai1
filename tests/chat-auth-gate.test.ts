import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '@/app/api/chat/route';
import { createSessionCookie } from '@/lib/auth/session';

test('requires sign-in before any chat model interaction', async () => {
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

test('rejects oversized chat bodies before model or auth work', async () => {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(141 * 1024 * 1024),
      },
      body: JSON.stringify({ messages: [] }),
    }),
  );

  assert.equal(response.status, 413);
  assert.equal(await response.text(), 'Chat request body is too large.');
});

test('hides missing AI provider configuration details from chat users', async () => {
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalRender = process.env.RENDER;
  process.env.DEEPSEEK_API_KEY = '';
  process.env.RENDER = 'true';

  try {
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: createSessionCookie({
            id: 'google:chat-config-user',
            email: 'chat-config@example.com',
          }),
        },
        body: JSON.stringify({
          messages: [
            {
              id: 'message-1',
              role: 'user',
              parts: [{ type: 'text', text: 'ط§ط¨ط­ط« ط¹ظ† ط³ظٹط§ط±ط©' }],
            },
          ],
          locationSettings: { language: 'ar' },
        }),
      }),
    );
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /DEEPSEEK_API_KEY/);
    assert.doesNotMatch(text, /Missing production environment variables/);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalApiKey;
    }

    if (originalRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = originalRender;
    }
  }
});
