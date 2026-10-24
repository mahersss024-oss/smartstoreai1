import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { GET as bootstrap } from '@/app/api/mobile/bootstrap/route';
import { GET as ownedListing } from '@/app/api/marketplace/me/listings/[listingId]/route';
import { GET as listingContact } from '@/app/api/marketplace/listings/[listingId]/contact/route';
import { createListingDraft, publishListing, resetMarketplaceStoreForTests } from '@/agent/marketplace/store';
import { createSignedSession, platformAgreementVersion } from '@/lib/auth/session';
import { marketplaceCategoryDefinitions } from '@/lib/marketplace/categories';
import { platformPolicies } from '@/lib/platform/policies';
import { prisma } from '@/lib/db/prisma';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

const context = (listingId: string) => ({ params: Promise.resolve({ listingId }) });
const request = (token?: string) => new Request('https://souqhamad.test/api/test', {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

test('native bootstrap uses authoritative policies/catalog and advertises unavailable auth truthfully', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file', DATABASE_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_NATIVE_CLIENT_ID: '', APPLE_NATIVE_CLIENT_ID: '', AUTH_SECRET: 'bootstrap-test-secret-not-public', SMARTSTORE_MAX_IMAGES_PER_LISTING: '5', SMARTSTORE_MAX_LISTINGS_PER_SELLER: '42' });
  const response = await bootstrap(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  const payload = await response.json();
  assert.equal(payload.categories.length, marketplaceCategoryDefinitions.length);
  assert.deepEqual(payload.policies, platformPolicies);
  assert.deepEqual(payload.auth, { google: false, apple: false });
  assert.equal(payload.policyVersions.platformAgreementVersion, platformAgreementVersion);
  assert.equal(payload.commissionRatePercent, 1);
  assert.deepEqual(payload.assistant.capabilities, ['listing_drafts', 'platform_help']);
  assert.equal(payload.limits.maxListingImages, 5);
  assert.equal(payload.limits.maxListingsPerSeller, 42);
  assert.equal(payload.siteMessage, null);
  assert.ok(payload.cities.includes('الرياض'));
  const cars = payload.categories.find((category: { id: string }) => category.id === 'cars');
  assert.ok(cars.options.some((option: { id: string }) => option.id === 'toyota'));
  assert.ok(cars.carModels.toyota.some((model: { id: string }) => model.id === 'camry'));
  assert.ok(!JSON.stringify(payload).includes('bootstrap-test-secret-not-public'));
});

test('owned detail admits only the authenticated owner including unpublished drafts', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file' });
  resetMarketplaceStoreForTests(); mockAllowedTextAnalysis(t);
  const draft = createListingDraft({ sellerId: 'native-owner', category: 'other', title: 'مكتب خشبي', description: 'مكتب للاستخدام المنزلي' });
  assert.equal((await ownedListing(request(), context(draft.id))).status, 401);
  const other = createSignedSession({ id: 'native-other', email: 'other@example.test' });
  assert.equal((await ownedListing(request(other), context(draft.id))).status, 404);
  const owner = createSignedSession({ id: 'native-owner', email: 'owner@example.test' });
  const response = await ownedListing(request(owner), context(draft.id));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).listing.id, draft.id);
  assert.match(response.headers.get('cache-control')!, /no-store/);
});

test('contact hides unpublished listings and self-contact and returns no unrelated seller data', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'file' });
  resetMarketplaceStoreForTests(); mockAllowedTextAnalysis(t);
  const draft = createListingDraft({ sellerId: 'native-contact-seller', category: 'other', title: 'مكتب خشبي' });
  assert.equal((await listingContact(request(), context(draft.id))).status, 404);
  publishListing(draft.id);
  const owner = createSignedSession({ id: draft.sellerId, email: 'owner@example.test' });
  assert.equal((await listingContact(request(owner), context(draft.id))).status, 409);
  const response = await listingContact(request(), context(draft.id));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { phoneNumber: null });
});

test('published contact returns only saved seller phone and excludes deleted sellers', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'database' });
  let deletedAt: Date | null = null;
  const original = { listing: prisma.listing.findUnique, user: prisma.user.findUnique, listings: prisma.listing.findMany,
    listingCount: prisma.listing.count, follows: prisma.sellerFollow.count, ratings: prisma.sellerRating.aggregate };
  t.after(() => {
    prisma.listing.findUnique = original.listing; prisma.user.findUnique = original.user;
    prisma.listing.findMany = original.listings; prisma.listing.count = original.listingCount;
    prisma.sellerFollow.count = original.follows; prisma.sellerRating.aggregate = original.ratings;
  });
  prisma.listing.findUnique = (async () => ({
    id: 'native-published', sellerId: 'native-seller-db', category: 'other', status: 'published', title: 'مكتب', attributes: {}, images: [],
    createdAt: new Date(), updatedAt: new Date(), firstPublicationTracked: true, views: 0, messageCount: 0, favoriteCount: 0,
  })) as unknown as typeof prisma.listing.findUnique;
  prisma.user.findUnique = (async ({ where }: { where: { id: string } }) => {
    assert.equal(where.id, 'native-seller-db');
    return { id: where.id, name: 'Seller', phoneNumber: '+966551234567', email: 'never-public@example.test', role: 'user', createdAt: new Date(), deletedAt };
  }) as unknown as typeof prisma.user.findUnique;
  prisma.listing.findMany = (async () => []) as unknown as typeof prisma.listing.findMany;
  prisma.listing.count = (async () => 1) as unknown as typeof prisma.listing.count;
  prisma.sellerFollow.count = (async () => 0) as unknown as typeof prisma.sellerFollow.count;
  prisma.sellerRating.aggregate = (async () => ({ _avg: { rating: null }, _count: { rating: 0 } })) as unknown as typeof prisma.sellerRating.aggregate;
  assert.deepEqual(await (await listingContact(request(), context('native-published'))).json(), { phoneNumber: '+966551234567' });
  deletedAt = new Date();
  assert.deepEqual(await (await listingContact(request(), context('native-published'))).json(), { phoneNumber: null });
});
