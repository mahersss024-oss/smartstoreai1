import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/marketplace/listings/[listingId]/route';
import { listSimilarMarketplaceListings } from '@/agent/marketplace/repository';
import { getComparableListings } from '@/agent/marketplace/market-intelligence';
import * as store from '@/agent/marketplace/store';

test('existing listing GET exposes up to 20 public similar cards and keeps normal detail unchanged', async t => {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  store.resetMarketplaceStoreForTests();
  const reference = store.createListingDraft({ sellerId: 'reference-owner', category: 'furniture', title: 'oak dining table' });
  store.publishListing(reference.id);
  for (let i = 0; i < 25; i++) {
    const candidate = store.createListingDraft({ sellerId: 'card-owner', category: 'furniture', title: 'oak dining table' });
    for (const [suffix, status, primary] of [[0, 'approved', false], [1, 'approved', true], [2, 'pending_review', false]] as const) {
      store.addListingImageForSeller(candidate.id, candidate.sellerId, {
        id: candidate.id + suffix, listingId: candidate.id,
        originalUrl: 'https://images.example.test/' + suffix + '.webp',
        displayUrl: 'https://images.example.test/' + suffix + '-display.webp',
        thumbnailUrl: 'https://images.example.test/' + suffix + '-thumbnail.webp',
        status, isPrimary: primary, qualityScore: 90, enhancements: [],
      });
    }
    store.publishListing(candidate.id);
  }
  const hidden = store.createListingDraft({ sellerId: 'hidden-owner', category: 'furniture', title: 'oak dining table' });
  store.publishListing(hidden.id);
  store.setListingStatusForSeller(hidden.id, hidden.sellerId, 'paused');
  const different = store.createListingDraft({ sellerId: 'other-owner', category: 'other', title: 'oak dining table' });
  store.publishListing(different.id);
  const context = { params: Promise.resolve({ listingId: reference.id }) };
  const response = await GET(new Request('https://souqhamad.test/api/marketplace/listings/' + reference.id + '?view=similar'), context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  const body = await response.json();
  assert.equal(body.listings.length, 20);
  assert.equal(new Set(body.listings.map((listing: store.ListingRecord) => listing.id)).size, 20);
  for (const listing of body.listings as store.ListingRecord[]) {
    assert.ok(![reference.id, hidden.id, different.id].includes(listing.id));
    assert.equal(listing.status, 'published');
    assert.equal(listing.images.length, 1);
    assert.equal(listing.images[0].status, 'approved');
    assert.equal(listing.images[0].isPrimary, true);
  }
  const detailContext = { params: Promise.resolve({ listingId: body.listings[0].id }) };
  const detail = await GET(new Request('https://souqhamad.test/api/marketplace/listings/' + body.listings[0].id), detailContext);
  assert.equal((await detail.json()).listing.images.length, 2);
  store.setListingStatusForSeller(reference.id, reference.sellerId, 'paused');
  assert.equal((await GET(new Request('https://souqhamad.test/api/marketplace/listings/' + reference.id + '?view=similar'), context)).status, 404);
});

test('similar card ranking scans beyond the first batch and rechecks public records before loading card media', async t => {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  const reference: store.ListingRecord = {
    id: 'reference', sellerId: 'reference-owner', category: 'cars', title: 'family sedan clean',
    city: 'Riyadh', attributes: { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry' },
    status: 'published', images: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    views: 0, messageCount: 0, favoriteCount: 0, compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
  };
  const rows = Array.from({ length: 300 }, (_, index) => ({
    ...reference, id: 'candidate-' + String(index).padStart(3, '0'),
    sellerId: 'candidate-owner',
    title: index === 299 ? 'commuter vehicle' : reference.title,
    description: null, city: reference.city!,
    attributes: index === 299 ? reference.attributes : {},
    price: 50000, priceMode: 'fixed', condition: 'used',
    createdAt: new Date(reference.createdAt), updatedAt: new Date(reference.updatedAt),
    compliance: reference.compliance,
  }));
  const readQueries: Record<string, unknown>[] = [];
  const originalFirst = prisma.listing.findFirst;
  const originalMany = prisma.listing.findMany;
  t.after(() => {
    prisma.listing.findFirst = originalFirst;
    prisma.listing.findMany = originalMany;
  });
  prisma.listing.findFirst = t.mock.fn(async () => ({ id: reference.id })) as unknown as typeof prisma.listing.findFirst;
  prisma.listing.findMany = t.mock.fn(async (input: unknown) => {
    const args = input as { where: { status: string; category: string; seller: { deletedAt: null }; id: { gt?: string; not?: string; in?: string[] } }; select?: Record<string, unknown>; include?: { images: { where: { status: string }; take: number } }; take?: number };
    readQueries.push(args as unknown as Record<string, unknown>);
    assert.equal(args.where.status, 'published');
    assert.equal(args.where.category, 'cars');
    assert.deepEqual(args.where.seller, { deletedAt: null });
    if (args.select) {
      assert.equal(args.select.images, undefined);
      assert.equal(args.select.compliance, undefined);
      assert.equal(args.select.price, undefined);
      assert.equal(args.take, 128);
      const cursor = args.where.id.gt;
      return rows.filter(row => !cursor || row.id > cursor).slice(0, args.take) as never;
    }
    assert.equal(args.include!.images.where.status, 'approved');
    assert.equal(args.include!.images.take, 1);
    assert.equal(args.where.id.in!.length, 20);
    // Simulate a concurrent pause between candidate scan and final card read.
    return rows.filter(row => args.where.id.in!.includes(row.id) && row.id !== 'candidate-298').reverse().map(row => ({ ...row, images: [] })) as never;
  }) as typeof prisma.listing.findMany;
  const cards = await listSimilarMarketplaceListings(reference);
  assert.equal(readQueries.filter(query => query.select).length, 3);
  assert.equal(cards[0].id, 'candidate-299');
  assert.equal(cards.length, 19);
  assert.ok(cards.every(card => card.id !== 'candidate-298'));
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
});

test('existing city, year and mileage comparability gates still apply to similar cards', () => {
  const reference = {
    id: 'reference', sellerId: 'seller', category: 'cars', title: 'family sedan',
    city: 'Riyadh', attributes: { marketplaceCategoryOption: 'toyota', marketplaceCarModel: 'camry', year: 2020, mileage: 50000 },
    status: 'published', images: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    views: 0, messageCount: 0, favoriteCount: 0, compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
  } as store.ListingRecord;
  const candidate = (id: string, changes: Partial<store.ListingRecord>) => ({ ...reference, id, ...changes });
  const result = getComparableListings(reference, [
    candidate('city', { city: 'Jeddah' }),
    candidate('year', { attributes: { ...reference.attributes, year: 2015 } }),
    candidate('mileage', { attributes: { ...reference.attributes, mileage: 150000 } }),
    candidate('available', { attributes: { ...reference.attributes, year: 2022, mileage: 60000 } }),
  ]);
  assert.deepEqual(result.map(listing => listing.id), ['available']);
});
