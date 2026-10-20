import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

beforeEach(mockAllowedTextAnalysis);
import test from 'node:test';

import { POST } from '@/app/api/marketplace/listings/route';
import { PATCH } from '@/app/api/marketplace/listings/[listingId]/route';
import { createSessionCookie } from '@/lib/auth/session';
import { listingCategoryClassifier } from '@/agent/marketplace/listing-category-model';
import { getListing } from '@/agent/marketplace/store';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';

test('existing routes support photo-free publication, model category and unchanged ownership', async t => {
  t.mock.method(listingCategoryClassifier, 'suggest', async () => ({ category: 'mobile_phones', status: 'suggested' }));
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const headers = {
      Cookie: createSessionCookie({ id: 'photo-free-seller', email: 'photo-free@example.test' }).split(';')[0],
      'Content-Type': 'application/json',
    };
    const created = await POST(new Request('http://localhost/api/marketplace/listings', {
      method: 'POST', headers,
      body: JSON.stringify({ category: 'other', autoCategory: true, title: 'iPhone 15' }),
    }));
    assert.equal(created.status, 201);
    const { listing } = await created.json();
    assert.equal(listing.category, 'mobile_phones');
    assert.deepEqual(listing.images, []);
    const context = { params: Promise.resolve({ listingId: listing.id }) };
    const url = `http://localhost/api/marketplace/listings/${listing.id}`;
    const publish = (requestHeaders: Record<string, string>) => PATCH(new Request(url, {
      method: 'PATCH', headers: requestHeaders, body: JSON.stringify({ action: 'publish' }),
    }), context);
    assert.equal((await publish({ 'Content-Type': 'application/json' })).status, 401);
    assert.equal((await publish({ ...headers, Cookie: createSessionCookie({ id: 'other-seller', email: 'other@example.test' }).split(';')[0] })).status, 404);
    const response = await publish(headers);
    assert.equal(response.status, 200);
    const published = (await response.json()).listing;
    assert.equal(published.status, 'published');
    assert.deepEqual(published.images, []);
    assert.ok(published.firstPublishedAt);
    const repeated = (await (await publish(headers)).json()).listing;
    assert.equal(repeated.firstPublishedAt, published.firstPublishedAt);
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

for (const category of ['animals', 'mobile_phones']) {
  test(`manual ${category} ads keep their description without assigning or inferring a condition`, async t => {
    const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
    process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
    t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
    const analysis = textAnalysis({ category: category as 'animals' | 'mobile_phones', search: { ...textAnalysis().search, condition: 'new' } });
    t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
    const headers = {
      Cookie: createSessionCookie({ id: `manual-description-${category}`, email: `${category}@example.test` }).split(';')[0],
      'Content-Type': 'application/json',
    };
    const description = category === 'animals' ? 'أغنام بصحة جيدة، التفاصيل موضحة في الوصف.' : 'جوال جديد لم يستخدم، وصف الحالة من البائع.';
    const response = await POST(new Request('http://localhost/api/marketplace/listings', {
      method: 'POST', headers, body: JSON.stringify({ category, autoCategory: false, title: 'إعلان تجريبي', description, city: 'الرياض', price: 100 }),
    }));
    assert.equal(response.status, 201);
    const { listing } = await response.json();
    assert.equal(listing.description, description);
    assert.equal(Object.hasOwn(listing, 'condition'), false);
    assert.equal(getListing(listing.id)?.condition, undefined);
    const published = await PATCH(new Request(`http://localhost/api/marketplace/listings/${listing.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ action: 'publish' }),
    }), { params: Promise.resolve({ listingId: listing.id }) });
    assert.equal(published.status, 200);
    const saved = (await published.json()).listing;
    assert.equal(saved.status, 'published');
    assert.equal(saved.description, description);
    assert.equal(Object.hasOwn(saved, 'condition'), false);
  });
}

test('accepted manual title category survives conflicting description analysis at save time', async t => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const analysis = textAnalysis({ category: 'computers' });
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  const classify = t.mock.method(listingCategoryClassifier, 'suggest', async () => { throw new Error('Accepted manual categories must not be reclassified'); });
  const response = await POST(new Request('http://localhost/api/marketplace/listings', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      Cookie: createSessionCookie({ id: 'manual-title-save', email: 'manual-title-save@example.test' }).split(';')[0] },
    body: JSON.stringify({ category: 'watches_accessories', autoCategory: false, title: 'نظارة شمسية',
      description: 'أبيع النظارة ولا أبيع الحاسب المذكور للمقارنة.',
      attributes: { marketplaceCategoryOption: 'eyewear' } }),
  }));
  assert.equal(response.status, 201);
  const { listing } = await response.json();
  assert.equal(listing.category, 'watches_accessories');
  assert.equal(listing.attributes.marketplaceCategoryOption, 'eyewear');
  assert.equal(listing.status, 'draft');
  assert.equal(classify.mock.callCount(), 0);
  assert.equal(analyze.mock.callCount(), 1);
});
