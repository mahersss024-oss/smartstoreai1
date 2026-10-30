import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = process.cwd();

function readSource(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

test('customer detail links preserve resources through the native gateway', () => {
  for (const path of ['app/listings/[listingId]/page.tsx', 'app/sellers/[sellerId]/page.tsx']) {
    const page = readSource(path);
    assert.match(page, /CustomerAppGateway/);
    assert.match(page, /encodeURIComponent/);
    assert.match(page, /generateMetadata/);
    assert.match(page, /notFound\(\)/);
    assert.doesNotMatch(page, /ListingContactActions|SellerProfileActions|SimilarListingsSection/);
  }
});

test('browser previews remain privileged and read-only on existing resource paths', () => {
  const listing = readSource('app/listings/[listingId]/page.tsx');
  const seller = readSource('app/sellers/[sellerId]/page.tsx');
  const preview = readSource('components/admin/customer-record-preview.tsx');
  assert.match(listing, /hasVerifiedModeratorAccess\(session\)/);
  assert.match(seller, /hasVerifiedAdminAccess\(session\)/);
  assert.match(preview, /data-admin-record-preview/);
  assert.match(preview, /ListingImageGallery/);
  assert.doesNotMatch(preview, /ListingContactActions|SellerProfileActions|fetch\(|onClick=|phoneNumber|\.email/);
  assert.match(preview, /href=\{back\}/);
});

test('private customer gateways never query or embed conversation contents', () => {
  const page = readSource('app/conversations/[conversationId]/page.tsx');
  assert.match(page, /CustomerAppGateway/);
  assert.doesNotMatch(page, /getConversation|listConversations|messages|buyerId|sellerId|fetch\(/);
});

test('public seller profile exposes real trust actions without private seller APIs', () => {
  const actions = readSource('app/sellers/[sellerId]/seller-profile-actions.tsx');

  assert.match(actions, /api\/marketplace\/users\/\$\{encodedSellerId\}\/follow/);
  assert.match(actions, /api\/marketplace\/users\/\$\{encodedSellerId\}\/ratings/);
  assert.match(actions, /api\/marketplace\/users\/\$\{encodedSellerId\}\/reports/);
  assert.match(actions, /seller-profile-report/);
  assert.match(actions, /<FloatingActionNotice/);
  assert.match(actions, /تم حفظ التقييم/);
  assert.match(actions, /بلاغ من صفحة المعلن العامة/);
  assert.doesNotMatch(actions, /سيتم تفعيل المتابعة في مرحلة لاحقة/);
  assert.doesNotMatch(actions, /MoreVertical/);
  assert.doesNotMatch(actions, /api\/marketplace\/sellers/);
});

test('repository public seller profile reads public accounts and published listings only', () => {
  const repository = readSource('agent/marketplace/repository.ts');

  assert.match(repository, /export type PublicSellerProfile/);
  assert.match(repository, /getPublicSellerProfile/);
  assert.match(repository, /publishedListingCount/);
  assert.match(repository, /status: 'published'/);
  assert.match(repository, /prisma\.sellerFollow\.count/);
  assert.match(repository, /prisma\.sellerRating\.aggregate/);
  assert.match(repository, /if \(!seller\) \{/);
  assert.doesNotMatch(repository, /publishedListingCount === 0/);
  assert.doesNotMatch(repository, /take: 24/);
  assert.doesNotMatch(repository, /slice\(0, 24\)/);
  assert.doesNotMatch(repository, /email: seller\.email/);
});

test('seller trust routes reuse marketplace user paths and existing user reports', () => {
  const followRoute = readSource('app/api/marketplace/users/[userId]/follow/route.ts');
  const ratingRoute = readSource('app/api/marketplace/users/[userId]/ratings/route.ts');
  const reportRoute = readSource('app/api/marketplace/users/[userId]/reports/route.ts');
  const schema = readSource('prisma/schema.prisma');
  const migration = readSource(
    'prisma/migrations/20260926090000_seller_trust_features/migration.sql',
  );

  assert.match(followRoute, /toggleSellerFollow/);
  assert.match(followRoute, /self_follow_blocked/);
  assert.match(ratingRoute, /rateSeller/);
  assert.match(ratingRoute, /self_rating_blocked/);
  assert.match(reportRoute, /reportUserDirect/);
  assert.match(reportRoute, /already_reported/);
  assert.match(migration, /UserReport_unique_open_direct_user_report/);
  assert.match(migration, /"conversationId" IS NULL/);
  assert.match(schema, /model SellerFollow/);
  assert.match(schema, /model SellerRating/);
  assert.match(schema, /model UserReport/);
});
