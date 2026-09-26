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
  const sellerLabelIndex = page.indexOf('المعلن');
  const galleryIndex = page.indexOf('<ListingImageGallery');

  assert.match(page, /getPublicSellerProfile/);
  assert.match(page, /href=\{`\/sellers\/\$\{listing\.sellerId\}`\}/);
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
});

test('public seller profile renders safe public data and published listing links', () => {
  const page = readSource('app/sellers/[sellerId]/page.tsx');

  assert.match(page, /getPublicSellerProfile/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /الإعلانات/);
  assert.match(page, /href=\{`\/listings\/\$\{listing\.id\}`\}/);
  assert.match(page, /SellerProfileActions/);
  assert.match(page, /تقييم المعلن/);
  assert.match(page, /سيتم تفعيل التقييم في مرحلة لاحقة/);
  assert.doesNotMatch(page, /seller\.email/);
  assert.doesNotMatch(page, /api\/marketplace\/ratings/);
});

test('public seller profile reports through the existing listing report route', () => {
  const actions = readSource('app/sellers/[sellerId]/seller-profile-actions.tsx');

  assert.match(actions, /api\/marketplace\/listings\/\$\{reportListingId\}\/reports/);
  assert.match(actions, /seller-profile-report/);
  assert.match(actions, /بلاغ من صفحة المعلن العامة/);
  assert.match(actions, /متابعة/);
  assert.match(actions, /سيتم تفعيل المتابعة في مرحلة لاحقة/);
  assert.doesNotMatch(actions, /MoreVertical/);
  assert.doesNotMatch(actions, /follow/i);
  assert.doesNotMatch(actions, /api\/marketplace\/sellers/);
  assert.doesNotMatch(actions, /api\/marketplace\/users/);
});

test('repository public seller profile reads published listings only', () => {
  const repository = readSource('agent/marketplace/repository.ts');

  assert.match(repository, /export type PublicSellerProfile/);
  assert.match(repository, /getPublicSellerProfile/);
  assert.match(repository, /publishedListingCount/);
  assert.match(repository, /status: 'published'/);
  assert.doesNotMatch(repository, /email: seller\.email/);
});
