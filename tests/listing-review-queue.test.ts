import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import * as store from '@/agent/marketplace/store';
import { listModerationQueuePage } from '@/agent/marketplace/repository';
import { recordModelReview } from '@/lib/admin/model-review';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';

test('published listing and image concerns remain queued until a human decision, not notification reading', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const listing = store.createListingDraft({ sellerId: 'review-queue-owner', title: 'review fixture', category: 'other' });
    store.publishListing(listing.id);
    const contains = () => store.listModerationQueue().listings.some(item => item.id === listing.id);
    assert.equal(contains(), false);
    const review = { subject: 'listing' as const, subjectId: listing.id, listingId: listing.id,
      userId: listing.sellerId, text: 'original concern', assessment: { decision: 'needs_review' as const, reasons: ['review'] } };
    await recordModelReview(review);
    assert.equal(contains(), true);
    assert.equal(store.getListing(listing.id)?.status, 'published');
    store.setListingModerationStatus(listing.id, 'published');
    assert.equal(contains(), false);
    await recordModelReview(review);
    assert.equal(contains(), false, 'duplicate assessment does not reopen a completed review');
    await recordModelReview({ ...review, subject: 'message', text: 'conversation concern' });
    assert.equal(contains(), false, 'conversation concerns are not listing reviews');
    await recordModelReview({ ...review, subject: 'image', text: 'new image concern' });
    assert.equal(contains(), true, 'a new image assessment reopens review');
    store.setListingModerationStatus(listing.id, 'rejected');
    assert.equal(contains(), false);
    assert.equal(store.getListing(listing.id)?.status, 'rejected');
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database review queue pages unresolved listing and image alerts independently of inbox reads', async t => {
  const queries: Prisma.Sql[] = [];
  t.mock.method(prisma, '$queryRaw', async (query: Prisma.Sql) => { queries.push(query); return []; });
  const originalReportFind = prisma.report.findMany;
  const originalUserReportFind = prisma.userReport.findMany;
  prisma.report.findMany = t.mock.fn(async () => []) as typeof prisma.report.findMany;
  prisma.userReport.findMany = t.mock.fn(async () => []) as typeof prisma.userReport.findMany;
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    const result = await listModerationQueuePage({ page: 2, limit: 5 });
    assert.deepEqual(result.listings, []);
    const query = queries[0];
    assert.match(query.sql, /ModelReview/);
    assert.match(query.sql, /IN \('listing', 'image'\)/);
    assert.match(query.sql, /approve_listing/);
    assert.match(query.sql, /decision\."createdAt" >= alert\."createdAt"/);
    assert.doesNotMatch(query.sql, /ModelReviewRead/);
    assert.match(query.sql, /LIMIT \? OFFSET \?/);
    assert.deepEqual(query.values.slice(-2), [6, 5]);
  } finally {
    prisma.report.findMany = originalReportFind;
    prisma.userReport.findMany = originalUserReportFind;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
