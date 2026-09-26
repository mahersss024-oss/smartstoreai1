import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = process.cwd();

function readSource(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

test('listing details links to the public seller profile without exposing private contact data', () => {
  const page = readSource('app/listings/[listingId]/page.tsx');
  const gallery = readSource('app/listings/[listingId]/listing-image-gallery.tsx');
  const sellerLabelIndex = page.indexOf('المعلن');
  const galleryIndex = page.indexOf('<ListingImageGallery');

  assert.match(page, /getPublicSellerProfile/);
  assert.match(page, /encodeURIComponent\(listing\.sellerId\)/);
  assert.match(page, /href=\{sellerProfileHref\}/);
  assert.match(page, /\u0627\u0644\u0645\u0639\u0644\u0646/u);
  assert.ok(sellerLabelIndex !== -1 && galleryIndex !== -1);
  assert.ok(sellerLabelIndex < galleryIndex);
  assert.doesNotMatch(page, />\u0639\u0631\u0636 \u0627\u0644\u062d\u0633\u0627\u0628</u);
  assert.doesNotMatch(page, /sellerProfile\?\.email/);
  assert.doesNotMatch(page, /\u0627\u0644\u062b\u0642\u0629 \u0648\u0627\u0644\u0633\u0644\u0627\u0645\u0629/u);
  assert.doesNotMatch(page, /\u0627\u0644\u0625\u0639\u0644\u0627\u0646 \u0645\u0646\u0634\u0648\u0631 \u0628\u0639\u062f \u0641\u062d\u0635 \u0627\u0644\u0633\u064a\u0627\u0633\u0629/u);
  assert.doesNotMatch(page, /\u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u0623\u0635\u0644\u064a\u0629/u);

  const contactActions = readSource('app/listings/[listingId]/contact-actions.tsx');
  assert.doesNotMatch(contactActions, /ShieldCheck/);
  assert.doesNotMatch(contactActions, /\u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629 \u062a\u062a\u0645 \u062f\u0627\u062e\u0644 \u0633\u0648\u0642 \u062d\u0645\u062f/u);
  assert.doesNotMatch(page, /rounded-md border bg-white p-4 shadow-sm/);
  assert.doesNotMatch(page, /rounded-md border p-3/);
  assert.doesNotMatch(gallery, /rounded-md border bg-white shadow-sm/);
});

test('public seller profile renders safe public data and published listing links', () => {
  const page = readSource('app/sellers/[sellerId]/page.tsx');

  assert.match(page, /getPublicSellerProfile/);
  assert.match(page, /decodeURIComponent\(rawSellerId\)/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /href=\{`\/listings\/\$\{listing\.id\}`\}/);
  assert.match(page, /SellerProfileActions/);
  assert.match(page, /initialFollowerCount=\{seller\.followerCount\}/);
  assert.match(page, /initialRatingAverage=\{seller\.ratingAverage\}/);
  assert.match(page, /initialRatingCount=\{seller\.ratingCount\}/);
  assert.match(page, /grid-cols-\[5\.5rem_minmax\(0,1fr\)\]/);
  assert.match(page, /sm:grid-cols-\[7rem_minmax\(0,1fr\)_auto\]/);
  assert.match(page, /className="truncate text-sm font-bold"/);
  assert.match(page, /إعلانات المعلن/);
  assert.doesNotMatch(page, /سيتم تفعيل التقييم في مرحلة لاحقة/);
  assert.doesNotMatch(page, /seller\.email/);
});

test('public seller profile exposes real trust actions without private seller APIs', () => {
  const actions = readSource('app/sellers/[sellerId]/seller-profile-actions.tsx');

  assert.match(actions, /api\/marketplace\/users\/\$\{encodedSellerId\}\/follow/);
  assert.match(actions, /api\/marketplace\/users\/\$\{encodedSellerId\}\/ratings/);
  assert.match(actions, /api\/marketplace\/users\/\$\{encodedSellerId\}\/reports/);
  assert.match(actions, /seller-profile-report/);
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
