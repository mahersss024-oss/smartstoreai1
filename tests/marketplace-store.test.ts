import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { ListingLimitReachedError } from '@/agent/marketplace/listing-limits';
import { defaultMaxListingImages } from '@/agent/marketplace/listing-image-limits';
import {
  addConversationMessage,
  addListingImageForSeller,
  blockConversationUser,
  createConversationForListing,
  createListingDraft,
  deleteListingImageForSeller,
  getConversationBlockStatus,
  getConversationForUser,
  listModerationQueue,
  listMarketplaceListings,
  listAdminCommissions,
  listSellerListings,
  listSellerCommissions,
  listUserConversations,
  listUserFavorites,
  publishListing,
  reportConversationUser,
  reportListing,
  setUserReportModerationStatus,
  setListingModerationStatus,
  setPrimaryListingImageForSeller,
  setReportModerationStatus,
  setCommissionStatusForAdmin,
  setListingStatusForSeller,
  shareSellerContact,
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

test('requires an approved image before seller publishes listing', () => {
  const listing = createListingDraft({
    sellerId: 'seller:image-required',
    category: 'cars',
    title: 'سيارة عائلية للبيع',
  });

  const pending = setListingStatusForSeller(
    listing.id,
    'seller:image-required',
    'published',
  );

  assert.equal(pending?.status, 'pending');

  addListingImageForSeller(listing.id, 'seller:image-required', {
    id: 'publish-image-required',
    listingId: listing.id,
    originalUrl: 'https://images.example.com/car-original.jpg',
    displayUrl: 'https://images.example.com/car-display.jpg',
    thumbnailUrl: 'https://images.example.com/car-thumb.jpg',
    isPrimary: true,
    qualityScore: 90,
    status: 'approved',
    enhancements: [],
  });

  const published = setListingStatusForSeller(
    listing.id,
    'seller:image-required',
    'published',
  );

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

test('limits saved seller listings and frees a slot after deletion', () => {
  const originalLimit = process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER;
  process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER = '2';

  try {
    const firstListing = createListingDraft({
      sellerId: 'seller:listing-limit',
      category: 'cars',
      title: 'First listing',
    });
    createListingDraft({
      sellerId: 'seller:listing-limit',
      category: 'cars',
      title: 'Second listing',
    });

    assert.throws(
      () =>
        createListingDraft({
          sellerId: 'seller:listing-limit',
          category: 'cars',
          title: 'Third listing',
        }),
      ListingLimitReachedError,
    );

    setListingStatusForSeller(
      firstListing.id,
      'seller:listing-limit',
      'deleted',
    );
    const replacementListing = createListingDraft({
      sellerId: 'seller:listing-limit',
      category: 'cars',
      title: 'Replacement listing',
    });

    assert.equal(replacementListing.title, 'Replacement listing');
  } finally {
    if (originalLimit === undefined) {
      delete process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER;
    } else {
      process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER = originalLimit;
    }
  }
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
  assert.equal(blocked.message, null);
  assert.equal(blocked.reasons.includes('external_contact_attempt'), true);
  assert.equal(
    getConversationForUser(opened.conversation?.id ?? '', 'buyer:messages-2')
      ?.messages.length,
    0,
  );
});

test('blocks manual direct contact even for inspection coordination', () => {
  const listing = createListingDraft({
    sellerId: 'seller:messages-3',
    category: 'cars',
    title: 'سيارة نظيفة للبيع',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:messages-3');
  const sent = addConversationMessage(
    opened.conversation?.id ?? '',
    'buyer:messages-3',
    'ممكن موعد معاينة اليوم مساءً وهذا رقمي 0501234567',
  );

  assert.equal(sent.status, 'message_blocked');
  assert.equal(sent.message, null);
});

test('lets the seller share the official saved phone number', () => {
  const listing = createListingDraft({
    sellerId: 'seller:messages-4',
    category: 'cars',
    title: 'سيارة نظيفة للبيع',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:messages-4');
  const shared = shareSellerContact(
    opened.conversation?.id ?? '',
    'seller:messages-4',
    '+966501234567',
  );

  assert.equal(shared.status, 'shared');
  assert.equal(shared.message?.type, 'contact_share');
  assert.equal(shared.message?.metadata.phoneNumber, '+966501234567');
  assert.equal(
    getConversationForUser(opened.conversation?.id ?? '', 'buyer:messages-4')
      ?.messages[0]?.type,
    'contact_share',
  );
});

test('requires a saved seller phone before official contact sharing', () => {
  const listing = createListingDraft({
    sellerId: 'seller:messages-5',
    category: 'cars',
    title: 'سيارة نظيفة للبيع',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:messages-5');
  const shared = shareSellerContact(
    opened.conversation?.id ?? '',
    'seller:messages-5',
  );

  assert.equal(shared.status, 'missing_phone');
  assert.equal(shared.message, null);
});

test('lets conversation participants report and block the other user', () => {
  const listing = createListingDraft({
    sellerId: 'seller:messages-block',
    category: 'cars',
    title: 'سيارة للبيع',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(
    listing.id,
    'buyer:messages-block',
  );

  const report = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:messages-block',
    {
      reason: 'conversation_report',
      details: 'رسائل غير مناسبة',
    },
  );
  const block = blockConversationUser(
    opened.conversation?.id ?? '',
    'buyer:messages-block',
    'conversation_block',
  );
  const afterBlock = addConversationMessage(
    opened.conversation?.id ?? '',
    'seller:messages-block',
    'هل ما زلت مهتمًا؟',
  );
  const blockStatus = getConversationBlockStatus(
    opened.conversation?.id ?? '',
    'buyer:messages-block',
  );

  assert.equal(report.status, 'reported');
  assert.equal(report.report?.targetUserId, 'seller:messages-block');
  assert.equal(block.status, 'blocked');
  assert.equal(blockStatus?.blocked, true);
  assert.equal(blockStatus?.blockedByMe, true);
  assert.equal(afterBlock.status, 'conversation_blocked');
  assert.equal(afterBlock.message, null);
});

test('prevents duplicate open conversation reports from the same reporter', () => {
  const listing = createListingDraft({
    sellerId: 'seller:report-dedup',
    category: 'cars',
    title: 'سيارة للبلاغ المكرر',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:report-dedup');
  const first = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:report-dedup',
    { reason: 'conversation_report', details: 'أول بلاغ' },
  );
  const duplicate = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:report-dedup',
    { reason: 'conversation_report', details: 'بلاغ مكرر' },
  );

  assert.equal(first.status, 'reported');
  assert.equal(duplicate.status, 'already_reported');
  assert.equal(duplicate.report?.id, first.report?.id);
});

test('lets an admin record a warning resolution on a conversation report', () => {
  const listing = createListingDraft({
    sellerId: 'seller:report-warn',
    category: 'cars',
    title: 'سيارة للتحذير',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:report-warn');
  const reported = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:report-warn',
    { reason: 'conversation_report' },
  );
  const warned = setUserReportModerationStatus(
    reported.report?.id ?? '',
    'warn',
  );

  assert.equal(warned.status, 'reviewed');
  assert.equal(warned.report?.resolution, 'warn');
});

test('restricting a conversation report blocks contact between the parties', () => {
  const listing = createListingDraft({
    sellerId: 'seller:report-restrict',
    category: 'cars',
    title: 'سيارة للتقييد',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(
    listing.id,
    'buyer:report-restrict',
  );
  const reported = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:report-restrict',
    { reason: 'conversation_report' },
  );
  const restricted = setUserReportModerationStatus(
    reported.report?.id ?? '',
    'restrict',
  );
  const blockStatus = getConversationBlockStatus(
    opened.conversation?.id ?? '',
    'buyer:report-restrict',
  );
  const afterMessage = addConversationMessage(
    opened.conversation?.id ?? '',
    'seller:report-restrict',
    'هل ما زلت مهتمًا؟',
  );

  assert.equal(restricted.status, 'reviewed');
  assert.equal(restricted.report?.resolution, 'restrict');
  assert.equal(blockStatus?.blocked, true);
  assert.equal(blockStatus?.blockedByMe, true);
  // Restricting closes the conversation, so later replies are still refused.
  assert.equal(afterMessage.status, 'conversation_closed');
  assert.equal(afterMessage.message, null);
});

test('keeps a conversation report open when the admin only reviews it', () => {
  const listing = createListingDraft({
    sellerId: 'seller:report-review',
    category: 'cars',
    title: 'سيارة للمراجعة',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(listing.id, 'buyer:report-review');
  const reported = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:report-review',
    { reason: 'conversation_report' },
  );
  const reviewed = setUserReportModerationStatus(
    reported.report?.id ?? '',
    'review',
  );

  assert.equal(reviewed.status, 'open');
  assert.equal(reviewed.report?.resolution, 'review');
});

test('does not change a conversation report after it is resolved', () => {
  const listing = createListingDraft({
    sellerId: 'seller:report-final-resolution',
    category: 'cars',
    title: 'سيارة لاختبار قرار البلاغ النهائي',
  });
  publishListing(listing.id);

  const opened = createConversationForListing(
    listing.id,
    'buyer:report-final-resolution',
  );
  const reported = reportConversationUser(
    opened.conversation?.id ?? '',
    'buyer:report-final-resolution',
    { reason: 'conversation_report' },
  );
  const dismissed = setUserReportModerationStatus(
    reported.report?.id ?? '',
    'dismiss',
  );
  const secondDecision = setUserReportModerationStatus(
    reported.report?.id ?? '',
    'warn',
  );

  assert.equal(dismissed.status, 'dismissed');
  assert.equal(secondDecision.status, 'already_resolved');
  assert.equal(secondDecision.report?.status, 'dismissed');
  assert.equal(secondDecision.report?.resolution, 'dismiss');
});

test('orders open conversation reports ahead of resolved ones in the queue', () => {
  const listing = createListingDraft({
    sellerId: 'seller:report-order',
    category: 'cars',
    title: 'سيارة للترتيب',
  });
  publishListing(listing.id);

  const resolvedConversation = createConversationForListing(
    listing.id,
    'buyer:report-order-resolved',
  );
  const resolvedReport = reportConversationUser(
    resolvedConversation.conversation?.id ?? '',
    'buyer:report-order-resolved',
    { reason: 'conversation_report' },
  );
  setUserReportModerationStatus(resolvedReport.report?.id ?? '', 'dismiss');

  const openConversation = createConversationForListing(
    listing.id,
    'buyer:report-order-open',
  );
  const openReport = reportConversationUser(
    openConversation.conversation?.id ?? '',
    'buyer:report-order-open',
    { reason: 'conversation_report' },
  );

  const queue = listModerationQueue();
  const openIndex = queue.userReports.findIndex(
    (report) => report.id === openReport.report?.id,
  );
  const resolvedIndex = queue.userReports.findIndex(
    (report) => report.id === resolvedReport.report?.id,
  );

  assert.notEqual(openIndex, -1);
  assert.notEqual(resolvedIndex, -1);
  assert.equal(openIndex < resolvedIndex, true);
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

test('paginates published marketplace listings', () => {
  for (let index = 0; index < 30; index += 1) {
    const listing = createListingDraft({
      sellerId: `seller:pagination-${index}`,
      category: 'furniture',
      title: `منتجصفحات ${index}`,
      city: 'تبوك',
    });

    publishListing(listing.id);
  }

  const firstPage = listMarketplaceListings({
    query: 'منتجصفحات',
    page: 1,
    limit: 10,
  });
  const secondPage = listMarketplaceListings({
    query: 'منتجصفحات',
    page: 2,
    limit: 10,
  });
  const firstPageIds = new Set(firstPage.map((listing) => listing.id));

  assert.equal(firstPage.length, 10);
  assert.equal(secondPage.length, 10);
  assert.equal(secondPage.some((listing) => firstPageIds.has(listing.id)), false);
});

test('hides deleted seller listings from account views', () => {
  const listing = createListingDraft({
    sellerId: 'seller:deleted-list',
    category: 'furniture',
    title: 'كرسي مكتب',
    price: 30,
  });

  setListingStatusForSeller(listing.id, 'seller:deleted-list', 'deleted');

  assert.equal(
    listSellerListings('seller:deleted-list').some(
      (result) => result.id === listing.id,
    ),
    false,
  );
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

test('limits stored listing images to the configured maximum', () => {
  const originalLimit = process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
  process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING = String(defaultMaxListingImages);

  try {
    const listing = createListingDraft({
      sellerId: 'seller:image-limit',
      category: 'cars',
      title: 'Toyota Camry image limit',
    });

    for (let index = 0; index < defaultMaxListingImages + 1; index += 1) {
      addListingImageForSeller(listing.id, 'seller:image-limit', {
        id: `image-limit-${index}`,
        listingId: listing.id,
        originalUrl: `https://example.com/${index}.jpg`,
        displayUrl: `https://example.com/${index}.jpg`,
        thumbnailUrl: `https://example.com/${index}.jpg`,
        isPrimary: index === 0,
        qualityScore: 90,
        status: 'approved',
        enhancements: [],
      });
    }

    const updated = listSellerListings('seller:image-limit').find(
      (sellerListing) => sellerListing.id === listing.id,
    );

    assert.equal(updated?.images.length, defaultMaxListingImages);
    assert.equal(
      updated?.images.some(
        (image) => image.id === `image-limit-${defaultMaxListingImages}`,
      ),
      false,
    );
  } finally {
    if (originalLimit === undefined) {
      delete process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
    } else {
      process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING = originalLimit;
    }
  }
});

test('lets sellers set a primary listing image', () => {
  const listing = createListingDraft({
    sellerId: 'seller:image-primary',
    category: 'cars',
    title: 'Toyota Camry',
  });

  addListingImageForSeller(listing.id, 'seller:image-primary', {
    id: 'image-primary-1',
    listingId: listing.id,
    originalUrl: 'https://example.com/1.jpg',
    displayUrl: 'https://example.com/1.jpg',
    thumbnailUrl: 'https://example.com/1.jpg',
    isPrimary: true,
    qualityScore: 90,
    status: 'approved',
    enhancements: [],
  });
  const updated = addListingImageForSeller(listing.id, 'seller:image-primary', {
    id: 'image-primary-2',
    listingId: listing.id,
    originalUrl: 'https://example.com/2.jpg',
    displayUrl: 'https://example.com/2.jpg',
    thumbnailUrl: 'https://example.com/2.jpg',
    isPrimary: false,
    qualityScore: 90,
    status: 'approved',
    enhancements: [],
  });

  assert.equal(
    updated?.images.find((image) => image.id === 'image-primary-1')?.isPrimary,
    true,
  );

  const result = setPrimaryListingImageForSeller(
    listing.id,
    'seller:image-primary',
    'image-primary-2',
  );

  assert.equal(
    result?.images.find((image) => image.id === 'image-primary-1')?.isPrimary,
    false,
  );
  assert.equal(
    result?.images.find((image) => image.id === 'image-primary-2')?.isPrimary,
    true,
  );
});

test('deleting the primary listing image promotes another approved image', () => {
  const listing = createListingDraft({
    sellerId: 'seller:image-delete',
    category: 'cars',
    title: 'Toyota Corolla',
  });

  addListingImageForSeller(listing.id, 'seller:image-delete', {
    id: 'image-delete-1',
    listingId: listing.id,
    originalUrl: 'https://example.com/1.jpg',
    displayUrl: 'https://example.com/1.jpg',
    thumbnailUrl: 'https://example.com/1.jpg',
    isPrimary: true,
    qualityScore: 90,
    status: 'approved',
    enhancements: [],
  });
  addListingImageForSeller(listing.id, 'seller:image-delete', {
    id: 'image-delete-2',
    listingId: listing.id,
    originalUrl: 'https://example.com/2.jpg',
    displayUrl: 'https://example.com/2.jpg',
    thumbnailUrl: 'https://example.com/2.jpg',
    isPrimary: false,
    qualityScore: 90,
    status: 'approved',
    enhancements: [],
  });

  const result = deleteListingImageForSeller(
    listing.id,
    'seller:image-delete',
    'image-delete-1',
  );

  assert.equal(
    result?.images.some((image) => image.id === 'image-delete-1'),
    false,
  );
  assert.equal(
    result?.images.find((image) => image.id === 'image-delete-2')?.isPrimary,
    true,
  );
});
