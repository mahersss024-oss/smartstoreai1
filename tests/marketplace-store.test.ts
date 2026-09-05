import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import {
  addConversationMessage,
  createConversationForListing,
  createListingDraft,
  getConversationForUser,
  listModerationQueue,
  listMarketplaceListings,
  listAdminCommissions,
  listSellerCommissions,
  listUserConversations,
  listUserFavorites,
  publishListing,
  reportListing,
  setListingModerationStatus,
  setReportModerationStatus,
  setCommissionStatusForAdmin,
  setListingStatusForSeller,
  toggleFavoriteListing,
  updateCommissionSaleAmountForSeller,
} from '@/agent/marketplace/store';

test('creates an allowed marketplace listing draft', () => {
  const listing = createListingDraft({
    sellerId: 'seller:test-1',
    category: 'mobile_phones',
    title: 'آيفون 14 برو للبيع',
    price: 3200,
    city: 'الرياض',
    condition: 'used',
  });

  assert.equal(listing.status, 'draft');
  assert.equal(listing.compliance.decision, 'allow');
  assert.equal(listing.sellerId, 'seller:test-1');
});

test('rejects a blocked listing draft before publishing', () => {
  const listing = createListingDraft({
    sellerId: 'seller:test-2',
    category: 'prohibited',
    title: 'مشروب كحولي للبيع',
  });

  assert.equal(listing.status, 'rejected');
  assert.equal(listing.compliance.decision, 'block');
});

test('publishes only compliant listings', () => {
  const listing = createListingDraft({
    sellerId: 'seller:test-3',
    category: 'computers',
    title: 'لابتوب للبيع',
  });
  const published = publishListing(listing.id);

  assert.equal(published?.status, 'published');
});

test('lets only the owner change listing status', () => {
  const listing = createListingDraft({
    sellerId: 'seller:status-owner',
    category: 'mobile_phones',
    title: 'جوال للبيع',
  });

  const unauthorized = setListingStatusForSeller(
    listing.id,
    'seller:other',
    'paused',
  );
  const paused = setListingStatusForSeller(
    listing.id,
    'seller:status-owner',
    'paused',
  );

  assert.equal(unauthorized, null);
  assert.equal(paused?.status, 'paused');
});

test('prevents opening a conversation with your own listing', () => {
  const listing = createListingDraft({
    sellerId: 'buyer:same-user',
    category: 'furniture',
    title: 'طاولة للبيع',
  });
  publishListing(listing.id);

  const result = createConversationForListing(listing.id, 'buyer:same-user');

  assert.equal(result.status, 'self_contact_blocked');
});

test('reuses an existing buyer seller conversation for the same listing', () => {
  const listing = createListingDraft({
    sellerId: 'seller:test-4',
    category: 'cars',
    title: 'كامري للبيع',
  });
  publishListing(listing.id);

  const first = createConversationForListing(listing.id, 'buyer:test-4');
  const second = createConversationForListing(listing.id, 'buyer:test-4');

  assert.equal(first.status, 'created');
  assert.equal(second.status, 'existing');
  assert.equal(second.conversation?.id, first.conversation?.id);
});

test('stores internal buyer seller messages for conversation participants', () => {
  const listing = createListingDraft({
    sellerId: 'seller:messages-1',
    category: 'mobile_phones',
    title: 'جوال نظيف للبيع',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:messages-1');
  assert.equal(opened.status, 'created');

  const sent = addConversationMessage(
    opened.conversation?.id ?? '',
    'buyer:messages-1',
    'السلام عليكم، هل الجهاز متوفر؟',
  );
  const buyerConversation = getConversationForUser(
    opened.conversation?.id ?? '',
    'buyer:messages-1',
  );
  const sellerConversations = listUserConversations('seller:messages-1');

  assert.equal(sent.status, 'sent');
  assert.equal(buyerConversation?.messages.length, 1);
  assert.equal(sellerConversations.some((conversation) => conversation.id === opened.conversation?.id), true);
});

test('blocks conversation messages that move contact outside the platform', () => {
  const listing = createListingDraft({
    sellerId: 'seller:messages-2',
    category: 'cars',
    title: 'سيارة للبيع',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:messages-2');
  const blocked = addConversationMessage(
    opened.conversation?.id ?? '',
    'buyer:messages-2',
    'هذا رقمي 0501234567 تواصل واتساب',
  );

  assert.equal(blocked.status, 'message_blocked');
  assert.equal(blocked.message?.status, 'blocked');
  assert.equal(blocked.message?.reasons.includes('external_contact_attempt'), true);
});

test('toggles favorite listings and updates the listing favorite count', () => {
  const listing = createListingDraft({
    sellerId: 'seller:favorites-1',
    category: 'computers',
    title: 'لابتوب للعمل',
  });
  publishListing(listing.id);

  const saved = toggleFavoriteListing(listing.id, 'buyer:favorites-1');

  assert.equal(saved.status, 'saved');
  assert.equal(saved.listing?.favoriteCount, 1);

  const favorites = listUserFavorites('buyer:favorites-1');
  assert.equal(favorites.some((favorite) => favorite.listingId === listing.id), true);

  const removed = toggleFavoriteListing(listing.id, 'buyer:favorites-1');
  assert.equal(removed.status, 'removed');
  assert.equal(removed.listing?.favoriteCount, 0);
});

test('stores listing reports for moderation review', () => {
  const listing = createListingDraft({
    sellerId: 'seller:reports-1',
    category: 'mobile_phones',
    title: 'جهاز للبيع',
  });
  publishListing(listing.id);

  const result = reportListing(
    listing.id,
    'buyer:reports-1',
    'misleading_images',
    'الصورة لا تطابق وصف الإعلان',
  );

  assert.equal(result.status, 'reported');
  assert.equal(result.report?.status, 'open');
  assert.equal(result.report?.reason, 'misleading_images');
});

test('lists moderation queue and prevents publishing blocked listings', () => {
  const sensitiveListing = createListingDraft({
    sellerId: 'seller:moderation-1',
    category: 'other',
    title: 'فيب للبيع',
  });
  const blockedListing = createListingDraft({
    sellerId: 'seller:moderation-2',
    category: 'other',
    title: 'مشروب كحولي للبيع',
  });

  const queue = listModerationQueue();
  const blockedPublish = setListingModerationStatus(
    blockedListing.id,
    'published',
  );
  const approvedSensitive = setListingModerationStatus(
    sensitiveListing.id,
    'published',
  );

  assert.equal(queue.listings.some((listing) => listing.id === sensitiveListing.id), true);
  assert.equal(blockedPublish.status, 'blocked_by_policy');
  assert.equal(approvedSensitive.status, 'published');
});

test('updates report moderation status', () => {
  const listing = createListingDraft({
    sellerId: 'seller:reports-2',
    category: 'computers',
    title: 'حاسب للبيع',
  });
  publishListing(listing.id);

  const reported = reportListing(listing.id, 'buyer:reports-2', 'fraud');
  const reviewed = setReportModerationStatus(
    reported.report?.id ?? '',
    'reviewed',
  );

  assert.equal(reviewed.status, 'reviewed');
});

test('creates a 1 percent commission when a seller marks a priced listing as sold', () => {
  const listing = createListingDraft({
    sellerId: 'seller:commission-1',
    category: 'mobile_phones',
    title: 'جوال للبيع',
    price: 2500,
  });
  publishListing(listing.id);

  setListingStatusForSeller(listing.id, 'seller:commission-1', 'sold');
  const commissions = listSellerCommissions('seller:commission-1');

  assert.equal(commissions.length, 1);
  assert.equal(commissions[0]?.productValue, 2500);
  assert.equal(commissions[0]?.commissionAmount, 25);
  assert.equal(commissions[0]?.status, 'due');
});

test('allows seller to provide final sale amount for pending commission', () => {
  const listing = createListingDraft({
    sellerId: 'seller:commission-2',
    category: 'cars',
    title: 'سيارة على السوم',
    price: 'bid',
  });
  publishListing(listing.id);

  setListingStatusForSeller(listing.id, 'seller:commission-2', 'sold');
  const pending = listSellerCommissions('seller:commission-2')[0];
  const updated = updateCommissionSaleAmountForSeller(
    pending?.id ?? '',
    'seller:commission-2',
    80000,
  );

  assert.equal(pending?.status, 'pending_amount');
  assert.equal(updated.status, 'updated');
  assert.equal(updated.commission?.commissionAmount, 800);
  assert.equal(updated.commission?.status, 'due');
});

test('lets admins update commission payment status', () => {
  const listing = createListingDraft({
    sellerId: 'seller:commission-3',
    category: 'computers',
    title: 'حاسب للبيع',
    price: 4000,
  });
  publishListing(listing.id);
  setListingStatusForSeller(listing.id, 'seller:commission-3', 'sold');

  const commission = listAdminCommissions().find(
    (record) => record.listingId === listing.id,
  );
  const paid = setCommissionStatusForAdmin(commission?.id ?? '', 'paid');

  assert.equal(paid.status, 'paid');
  assert.equal(paid.commission?.paidAt !== undefined, true);
});

test('searches published marketplace listings by buyer query', () => {
  const listing = createListingDraft({
    sellerId: 'seller:search-1',
    category: 'watches_accessories',
    title: 'ساعة ذكية زرقاء إصدار خاص',
    city: 'الرياض',
  });
  publishListing(listing.id);

  const results = listMarketplaceListings({ query: 'أبحث عن ساعة زرقاء في الرياض' });

  assert.equal(results.some((result) => result.id === listing.id), true);
});

test('flags low resolution images for retake', () => {
  const result = analyzeImageQuality({
    mimeType: 'image/jpeg',
    width: 320,
    height: 240,
  });

  assert.equal(result.recommendedAction, 'request_retake');
  assert.equal(result.listingImageStatus, 'needs_retake');
});

test('recommends blurring sensitive information without rejecting a useful image', () => {
  const result = analyzeImageQuality({
    mimeType: 'image/webp',
    width: 1600,
    height: 1200,
    hasDetectedPhoneNumber: true,
  });

  assert.equal(result.recommendedAction, 'blur_sensitive_info');
  assert.equal(result.listingImageStatus, 'approved');
  assert.equal(result.enhancements.includes('blur_sensitive_info'), true);
});
