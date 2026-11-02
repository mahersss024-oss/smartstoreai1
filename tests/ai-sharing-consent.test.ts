import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as chat } from '@/app/api/chat/route';
import { POST as category } from '@/app/api/marketplace/listing-category/route';
import { POST as createListing } from '@/app/api/marketplace/listings/route';
import { createSessionCookie } from '@/lib/auth/session';
import { aiConsentHeader, aiSharingConsent } from '@/lib/platform/ai-consent';
import { listingCategoryClassifier } from '@/agent/marketplace/listing-category-model';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';

function request(path: string, data: unknown, consent?: string) {
  return new Request(`http://localhost/api/${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json',
    Cookie: createSessionCookie({ id: 'consent-owner', email: 'consent@example.test' }),
    ...(consent ? { [aiConsentHeader]: consent } : {}),
  }, body: JSON.stringify(data) });
}

for (const consent of [undefined, 'an-obsolete-version']) {
  test(`AI requests without current consent cannot call a provider (${consent ?? 'absent'})`, async t => {
    t.mock.method(listingCategoryClassifier, 'suggest', async () => { assert.fail('No classification before consent'); });
    t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('No analysis before consent'); });
    t.mock.method(globalThis, 'fetch', async () => { assert.fail('No data may leave for an AI provider'); });
    for (const response of [
      await chat(request('chat', { messages: [] }, consent)),
      await category(request('marketplace/listing-category', { title: 'Desk' }, consent)),
      await createListing(request('marketplace/listings', { category: 'other', title: 'Desk', autoCategory: true }, consent)),
    ]) {
      assert.equal(response.status, 409);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.equal((await response.json()).error, 'ai_consent_required');
    }
  });
}

test('manual listing creation works without AI sharing; title suggestions require explicit current consent', async t => {
  let calls = 0;
  t.mock.method(listingCategoryClassifier, 'suggest', async (input: { title: string; description: string }) => {
    calls++;
    assert.deepEqual(input, { title: 'Desk', description: '' });
    return { category: 'furniture', status: 'suggested' };
  });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('Manual save must not invoke AI'); });
  const saved = await createListing(request('marketplace/listings', { category: 'furniture', title: 'Desk', autoCategory: false }));
  assert.equal(saved.status, 201);
  assert.equal(calls, 0);
  const suggestion = await category(request('marketplace/listing-category', { title: 'Desk', description: 'Private excluded description' }, aiSharingConsent.version));
  assert.equal(suggestion.status, 200);
  assert.equal(calls, 1);
});
