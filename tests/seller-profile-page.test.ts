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

  assert.match(page, /getPublicSellerProfile/);
  assert.match(page, /href=\{`\/sellers\/\$\{listing\.sellerId\}`\}/);
  assert.match(page, /المعلن/);
  assert.match(page, />عرض الحساب</);
  assert.doesNotMatch(page, /sellerProfile\?\.email/);
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
