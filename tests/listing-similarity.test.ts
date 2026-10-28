import assert from 'node:assert/strict';
import test from 'node:test';
import { getListingSimilarityScore, strongListingSimilarityThreshold } from '@/agent/marketplace/listing-similarity';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { getComparableListings } from '@/agent/marketplace/market-intelligence';
import * as store from '@/agent/marketplace/store';
import * as repository from '@/agent/marketplace/repository';
import { getLocalModelReviews } from '@/lib/admin/model-review';

const product = (id: string, title: string, attributes: Record<string, unknown> = {}, category = 'furniture') =>
  ({ id, title, attributes, category });

test('strong title matching normalizes Arabic spelling and digits without running models', t => {
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { throw new Error('No model allowed'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('No model cache allowed'); });
  assert.ok(getListingSimilarityScore(product('a', 'كنب زاوية ٥ قطع نظيف للبيع'), product('b', 'كنب زاويه 5 قطع')) >= strongListingSimilarityThreshold);
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(peek.mock.callCount(), 0);
});

test('broad categories and generic promotional words never manufacture a match', () => {
  assert.equal(getListingSimilarityScore(product('a', 'للبيع ممتاز'), product('b', 'للبيع ممتاز')), 0);
  assert.equal(getListingSimilarityScore(product('a', 'كنب زاوية'), product('b', 'طاولة طعام')), 0);
  assert.equal(getListingSimilarityScore(product('a', 'كنب زاوية'), product('b', 'كنب زاوية', {}, 'home_garden')), 0);
  assert.equal(getListingSimilarityScore(product('a', 'كنب زاوية'), product('a', 'كنب زاوية')), 0);
});

test('conflicting subcategories, brands, models and product variants are excluded', () => {
  assert.equal(getListingSimilarityScore(product('a', 'أثاث مكتب', { marketplaceCategoryOption: 'tables' }), product('b', 'أثاث مكتب', { marketplaceCategoryOption: 'chairs' })), 0);
  assert.equal(getListingSimilarityScore(product('a', 'هاتف', { brand: 'apple' }, 'mobile_phones'), product('b', 'هاتف', { brand: 'samsung' }, 'mobile_phones')), 0);
  assert.equal(getListingSimilarityScore(product('a', 'هاتف', { brand: 'apple', model: '13' }, 'mobile_phones'), product('b', 'هاتف', { brand: 'apple', model: '14' }, 'mobile_phones')), 0);
  assert.equal(getListingSimilarityScore(product('a', 'iphone 13 pro', {}, 'mobile_phones'), product('b', 'iphone 13 pro max', {}, 'mobile_phones')), 0);
  assert.equal(getListingSimilarityScore(product('a', 'مطلوب كنب زاوية'), product('b', 'كنب زاوية للبيع')), 0);
});

test('precise saved car catalog identity matches independent of title language', () => {
  const attributes = { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry' };
  assert.ok(getListingSimilarityScore(product('a', 'كامري نظيفة', attributes, 'cars'), product('b', 'Toyota Camry', attributes, 'cars')) >= strongListingSimilarityThreshold);
  assert.equal(getListingSimilarityScore(product('a', 'سيارة', attributes, 'cars'), product('b', 'سيارة', { ...attributes, marketplaceCarModel: 'corolla' }, 'cars')), 0);
});

test('manual save, edit, message and similarity remain operational with models unavailable', async t => {
  store.resetMarketplaceStoreForTests();
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { throw new Error('No model allowed'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('No model cache allowed'); });
  const reviewsBefore = getLocalModelReviews().length;
  const draft = await repository.createListingDraft({ id: 'deterministic-owner', email: 'deterministic-owner@example.test' }, { category: 'furniture', title: 'كنب زاوية ٥ قطع', autoCategory: true });
  assert.equal(draft.category, 'furniture');
  assert.equal(draft.compliance.modelAssessment, undefined);
  const edited = await repository.updateListingForSeller(draft.id, draft.sellerId, { title: 'كنب زاوية 5 قطع نظيف' });
  assert.ok(edited);
  store.publishListing(draft.id);
  const other = store.createListingDraft({ sellerId: 'second-owner', category: 'furniture', title: 'كنب زاويه ٥ قطع' });
  store.publishListing(other.id);
  assert.deepEqual(getComparableListings(edited!, [other]).map(item => item.id), [other.id]);
  const conversation = store.createConversationForListing(draft.id, 'deterministic-buyer').conversation!;
  const sent = await repository.addConversationMessage(conversation.id, 'deterministic-buyer', 'هل الإعلان متاح؟');
  assert.equal(sent.message?.status, 'sent');
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(peek.mock.callCount(), 0);
  assert.equal(getLocalModelReviews().length, reviewsBefore);
});


test('publishing notifies only followers of strongly matching products without model work', async t => {
  store.resetMarketplaceStoreForTests();
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { throw new Error('No model allowed'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('No model cache allowed'); });
  const reference = store.createListingDraft({ sellerId: 'follow-reference-owner', category: 'furniture', title: 'كنب زاوية ٥ قطع' });
  store.publishListing(reference.id);
  await repository.toggleSimilarListingFollow(reference.id, 'strong-follow-buyer');
  const near = store.createListingDraft({ sellerId: 'follow-published-owner', category: 'furniture', title: 'كنب زاويه 5 قطع نظيف' });
  const unrelated = store.createListingDraft({ sellerId: 'follow-other-owner', category: 'furniture', title: 'طاولة طعام ٥ كراسي' });
  await repository.setListingStatusForSeller(near.id, near.sellerId, 'published');
  await repository.setListingStatusForSeller(unrelated.id, unrelated.sellerId, 'published');
  const notifications = await repository.listAccountFollowNotifications('strong-follow-buyer');
  assert.ok(notifications.notifications.some(item => item.listingId === near.id));
  assert.ok(!notifications.notifications.some(item => item.listingId === unrelated.id));
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(peek.mock.callCount(), 0);
});
