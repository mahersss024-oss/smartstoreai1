import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { POST as chat } from '@/app/api/chat/route';
import { POST as category } from '@/app/api/marketplace/listing-category/route';
import { POST as createListing } from '@/app/api/marketplace/listings/route';
import { createSessionCookie } from '@/lib/auth/session';
import { aiConsentHeader, aiSharingConsent, hasAiSharingConsent } from '@/lib/platform/ai-consent';
import { listingCategoryClassifier } from '@/agent/marketplace/listing-category-model';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { resetMarketplaceStoreForTests } from '@/agent/marketplace/store';

beforeEach(t => {
  resetMarketplaceStoreForTests();
  assert.ok('mock' in t, 'These tests require per-test mock isolation');
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Consent tests must not contact a live provider'); });
});

function request(path: string, data: unknown, consent?: string) {
  return new Request(`http://localhost/api/${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json',
    Cookie: createSessionCookie({ id: 'consent-owner', email: 'consent@example.test' }),
    ...(consent ? { [aiConsentHeader]: consent } : {}),
  }, body: JSON.stringify(data) });
}

test('Hamad sharing accepts current and previously granted consent while rejecting unknown versions', () => {
  assert.equal(aiSharingConsent.version, 'ai-sharing-2026-11-02-v2');
  assert.doesNotMatch(JSON.stringify(aiSharingConsent), /deepseek|ديب[\s-]*سيك/iu);
  for (const consent of [aiSharingConsent.version, 'deepseek-sharing-2026-11-02-v1']) {
    assert.equal(hasAiSharingConsent(request('chat', { messages: [] }, consent)), true);
  }
  for (const consent of [undefined, '', 'an-obsolete-version']) {
    assert.equal(hasAiSharingConsent(request('chat', { messages: [] }, consent)), false);
  }
});

for (const consent of [undefined, 'an-obsolete-version']) {
  const consentLabel = consent ?? 'absent';
  test(`Hamad chat requires accepted sharing before analysis (${consentLabel})`, async t => {
    t.mock.method(listingCategoryClassifier, 'suggest', async () => { assert.fail('Chat may not classify before consent'); });
    t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('Chat may not analyze before consent'); });
    const response = await chat(request('chat', { messages: [] }, consent));
    assert.equal(response.status, 409);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    const payload = await response.json();
    assert.equal(payload.error, 'ai_consent_required');
    assert.deepEqual(payload.aiConsent, aiSharingConsent);
    assert.doesNotMatch(JSON.stringify(payload), /deepseek|ديب[\s-]*سيك/iu);
  });

  test(`title suggestions work independently of Hamad sharing (${consentLabel})`, async t => {
    const calls: Array<{ title: string; description: string }> = [];
    t.mock.method(listingCategoryClassifier, 'suggest', async (input: { title: string; description: string }) => {
      calls.push(input);
      return { category: 'furniture', status: 'suggested' };
    });
    t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('The suggestion route must use the existing classifier'); });
    const suggestion = await category(request('marketplace/listing-category', {
      title: '  Desk  ', description: 'Private excluded description',
    }, consent));
    assert.equal(suggestion.status, 200);
    assert.match(suggestion.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(await suggestion.json(), { category: 'furniture', status: 'suggested' });
    assert.deepEqual(calls, [{ title: 'Desk', description: '' }]);
  });

  test(`legacy automatic-category creation works without a sharing gate (${consentLabel})`, async t => {
    t.mock.method(listingCategoryClassifier, 'suggest', async () => { assert.fail('Saving a draft must not add classification calls'); });
    t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('Saving a draft must not add model review'); });
    const saved = await createListing(request('marketplace/listings', {
      category: 'furniture', title: 'Desk', autoCategory: true,
    }, consent));
    assert.equal(saved.status, 201);
    const { listing } = await saved.json();
    assert.equal(listing.sellerId, 'consent-owner');
    assert.equal(listing.category, 'furniture');
    assert.equal(listing.title, 'Desk');
  });
}

test('removing category consent preserves authentication for suggestions and automatic-category creation', async t => {
  t.mock.method(listingCategoryClassifier, 'suggest', async () => { assert.fail('Anonymous users may not classify'); });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('Anonymous users may not analyze'); });
  for (const [path, handler, body] of [
    ['marketplace/listing-category', category, { title: 'Desk' }],
    ['marketplace/listings', createListing, { category: 'furniture', title: 'Desk', autoCategory: true }],
  ] as const) {
    const response = await handler(new Request(`http://localhost/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'auth_required');
  }
});

test('manual listing creation remains independent of model sharing and inference', async t => {
  t.mock.method(listingCategoryClassifier, 'suggest', async () => { assert.fail('Manual save must not classify'); });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { assert.fail('Manual save must not analyze'); });
  const saved = await createListing(request('marketplace/listings', { category: 'furniture', title: 'Desk', autoCategory: false }));
  assert.equal(saved.status, 201);
  const { listing } = await saved.json();
  assert.equal(listing.sellerId, 'consent-owner');
  assert.equal(listing.category, 'furniture');
});
