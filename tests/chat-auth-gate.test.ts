import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { POST } from '@/app/api/chat/route';
import { POST as RESET_CHAT_POST } from '@/app/api/chat/reset/route';
import {
  getMarketplaceSearchState,
  resetMarketplaceSearchState,
  updateMarketplaceSearchState,
} from '@/agent/marketplace/search-state';
import {
  createListingDraft,
  listSellerListings,
} from '@/agent/marketplace/repository';
import { createSessionCookie } from '@/lib/auth/session';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

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

test('chat reset endpoint clears retained assistant search state', async () => {
  const userId = 'google:chat-reset-user';
  const ownerKey = `user:${userId}`;

  await resetMarketplaceSearchState(ownerKey);
  await updateMarketplaceSearchState(ownerKey, {
    intent: 'search_listing',
    category: 'cars',
    brand: 'Nissan',
    city: 'Tabuk',
    requiredFeatures: [],
    excludedFeatures: [],
    excludedColors: [],
    rankingPreferences: [],
    terms: [],
    rawQuery: 'old retained search',
  });
  const draft = await createListingDraft(
    { id: userId, email: 'chat-reset@example.com' },
    {
      category: 'cars',
      title: 'temporary assistant draft',
      description: 'created from a previous assistant chat session',
    },
  );

  assert.ok(await getMarketplaceSearchState(ownerKey));
  assert.equal(draft.status, 'draft');
  assert.equal(
    (await listSellerListings(userId)).some((listing) => listing.id === draft.id),
    true,
  );

  const response = await RESET_CHAT_POST(
    new Request('http://localhost/api/chat/reset', {
      method: 'POST',
      headers: {
        cookie: createSessionCookie({
          id: userId,
          email: 'chat-reset@example.com',
        }),
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(await getMarketplaceSearchState(ownerKey), null);
  assert.equal(
    (await listSellerListings(userId)).some((listing) => listing.id === draft.id),
    false,
  );
});

test('chat reset endpoint is rate limited because it mutates search and draft state', () => {
  const resetRoute = readProjectFile('app', 'api', 'chat', 'reset', 'route.ts');

  assert.match(resetRoute, /enforceApiRateLimit/);
  assert.match(resetRoute, /chat_reset/);
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
