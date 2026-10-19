import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import { createMarketplaceTools, createReadOnlyMarketplaceTools } from '@/agent/tools/marketplace';
import * as store from '@/agent/marketplace/store';
import * as repository from '@/agent/marketplace/repository';
import { GET } from '@/app/api/marketplace/listings/route';
import { getLocalModelReviews, recordModelReview } from '@/lib/admin/model-review';
import { acknowledgeReportNotification, listReportNotifications } from '@/lib/admin/report-notifications';
import { textAnalysis } from './helpers/text-understanding';

test('chat and site use identical title matches and explicit filters even when every model is unavailable', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  store.resetMarketplaceStoreForTests();
  const make = (id: string, category: string, city: string, price: number, condition: 'used' | 'new', title = 'آيفون ١٥') => {
    const listing = store.createListingDraft({ id, sellerId: `owner-${id}`, title, description: 'exclusive-description', category, city, price, condition, attributes: { year: 2025, mileage: 12000 } });
    store.publishListing(id);
    return listing;
  };
  make('db-only-1', 'mobile_phones', 'الرياض', 50, 'used');
  make('db-only-2', 'mobile_phones', 'الرياض', 70, 'new');
  make('db-only-3', 'computers', 'الرياض', 40, 'used');
  make('db-only-4', 'mobile_phones', 'جدة', 30, 'used');
  make('db-only-5', 'mobile_phones', 'الرياض', 20, 'used', 'هاتف مختلف');
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { throw new Error('Model must not run in database search'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('Cached model results must not filter search'); });
  const previousMode = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const filters = { category: 'mobile_phones' as const, city: 'الرياض', minPrice: 40, maxPrice: 80, condition: 'used' as const, yearMin: 2024, mileageMax: 20000 };
    const chat = await searchMarketplaceWithState({ ownerKey: 'no-model-search', query: 'ايفون 15', understoodIntent: filters });
    const site = await repository.listPublicMarketplaceListings({ query: 'ايفون 15', ...filters });
    assert.deepEqual(chat.listings.map(item => item.listing.id), site.map(item => item.id));
    assert.deepEqual(site.map(item => item.id), ['db-only-1']);
    const url = new URL('https://example.test/api/marketplace/listings');
    url.searchParams.set('q', 'ايفون 15');
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, String(value));
    const api = await GET(new Request(url));
    assert.equal(api.status, 200);
    assert.deepEqual((await api.json()).listings.map((item: { id: string }) => item.id), ['db-only-1']);
    const refined = await searchMarketplaceWithState({ ownerKey: 'no-model-search', understoodIntent: { searchMode: 'refine', maxPrice: 45 } });
    assert.equal(refined.listings.length, 0);
    const fresh = await searchMarketplaceWithState({ ownerKey: 'no-model-search', query: 'ايفون 15' });
    assert.equal(fresh.candidateCount, 4);
    assert.equal(fresh.searchState.city, undefined);
    const absent = await searchMarketplaceWithState({ ownerKey: 'no-model-search', query: 'exclusive-description' });
    assert.equal(absent.candidateCount, 0);
    const badCategory = await GET(new Request('https://example.test/api/marketplace/listings?category=imaginary'));
    assert.equal(badCategory.status, 400);
    assert.equal(analyze.mock.callCount(), 0);
    assert.equal(peek.mock.callCount(), 0);
  } finally {
    if (previousMode === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousMode;
  }
});

test('model concerns permit content and create separate administration alerts, never forged customer reports', async t => {
  const flagged = textAnalysis({ compliance: { decision: 'block', reasons: ['review_fixture'], shariaSensitive: false } });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => flagged);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => flagged);
  const before = getLocalModelReviews().length;
  const owner = { id: 'advisory-owner', email: 'advisory@example.test' };
  const draft = await repository.createListingDraft(owner, { title: 'advisory-content', category: 'other' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.compliance.modelAssessment?.decision, 'block');
  assert.equal(store.setListingStatusForSeller(draft.id, owner.id, 'published')?.status, 'published');
  const conversation = store.createConversationForListing(draft.id, 'advisory-buyer').conversation!;
  const sent = await repository.addConversationMessage(conversation.id, 'advisory-buyer', 'advisory-message');
  assert.equal(sent.message?.status, 'sent');
  const reviews = getLocalModelReviews().slice(before);
  assert.ok(reviews.some(item => item.subject === 'listing' && item.subjectId === draft.id));
  assert.ok(reviews.some(item => item.subject === 'message' && item.subjectId === conversation.id));
  assert.ok(!store.listModerationQueue().reports.some(report => report.listingId === draft.id));
});

test('human moderation survives seller edits and publication attempts until an administrator approves', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  const listing = store.createListingDraft({ sellerId: 'human-authority-owner', category: 'other', title: 'human review fixture' });
  store.publishListing(listing.id);
  store.setListingModerationStatus(listing.id, 'rejected');
  assert.equal(listing.compliance.humanDecision, 'block');
  assert.equal(store.updateListingForSeller(listing.id, listing.sellerId, { title: 'changed title' })?.status, 'rejected');
  assert.equal(store.setListingStatusForSeller(listing.id, listing.sellerId, 'published')?.status, 'rejected');
  assert.equal(store.publishListing(listing.id)?.status, 'rejected');
  assert.equal(store.setListingModerationStatus(listing.id, 'published').status, 'published');
  assert.equal(store.getListing(listing.id)?.compliance.humanDecision, 'allow');
});

test('regeneration exposes no draft write tools and unavailable output review never releases generated text', () => {
  const full = createMarketplaceTools(null);
  assert.ok('createListingDraft' in full);
  const safe = createReadOnlyMarketplaceTools();
  for (const name of ['createListingDraft', 'updateListing', 'addUploadedImagesToListing', 'setListingStatus', 'sendMessage', 'openConversation']) assert.ok(!(name in safe), name);
  assert.deepEqual(Object.keys(safe), ['getPlatformHelp']);
  const route = readFileSync('app/api/chat/route.ts', 'utf8');
  assert.match(route, /const retryAgent = createChatAgent\(session, \{[\s\S]*?answerOnly: true/);
  assert.match(route, /isOutputCheckerProviderFailure\(decision\)\) return getModelProviderFailureResponse/);
});

test('a concurrent human moderation decision cannot be overwritten by a seller content or publication write', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => textAnalysis());
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  const compliance = { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false };
  const record = { id: 'concurrent-human-authority', sellerId: 'seller', category: 'other', title: 'original title', description: null, city: null, price: 50, priceMode: null, condition: null,
    attributes: {}, images: [], compliance, status: 'published', createdAt: new Date(), updatedAt: new Date(), firstPublishedAt: new Date(), firstPublicationTracked: true };
  const originalFind = prisma.listing.findUnique;
  const originalTransaction = prisma.$transaction;
  let writes = 0;
  let humanDecisionChanged = false;
  prisma.listing.findUnique = (async () => humanDecisionChanged
    ? { ...record, status: 'rejected', compliance: { ...compliance, humanDecision: 'block' } }
    : record) as unknown as typeof prisma.listing.findUnique;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => run({ listing: {
    updateMany: async () => ({ count: 0 }),
    update: async (args: { where: { id: string; sellerId: string; status: string; compliance: { equals: unknown } } }) => {
      writes++;
      assert.equal(args.where.sellerId, 'seller');
      assert.equal(args.where.status, 'published');
      assert.deepEqual(args.where.compliance.equals, compliance);
      humanDecisionChanged = true;
      throw new Prisma.PrismaClientKnownRequestError('Human moderation changed concurrently', { code: 'P2025', clientVersion: 'test' });
    },
  } })) as unknown as typeof prisma.$transaction;
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    assert.equal(await repository.updateListingForSeller(record.id, 'seller', { title: 'late edit' }), null);
    humanDecisionChanged = false;
    assert.equal(await repository.setListingStatusForSeller(record.id, 'seller', 'published'), null);
    assert.equal(writes, 2);
  } finally {
    prisma.listing.findUnique = originalFind;
    prisma.$transaction = originalTransaction;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('advisory reviews reuse the system audit log and have shared idempotent acknowledgement', async () => {
  const previousMode = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const writes: Array<{ data: Array<Record<string, unknown>>; skipDuplicates: boolean }> = [];
  const database = { adminAuditLog: { createMany: async (args: typeof writes[number]) => { writes.push(args); return { count: 1 }; } } };
  try {
    const input = { subject: 'listing' as const, subjectId: 'audit-review-listing', listingId: 'audit-review-listing', userId: 'audit-review-user', text: JSON.stringify({ title: 'عنوان للمراجعة', description: 'وصف' }), assessment: { decision: 'block' as const, reasons: ['fixture'] } };
    await recordModelReview(input, database as unknown as Prisma.TransactionClient);
    await recordModelReview(input, database as unknown as Prisma.TransactionClient);
    assert.equal(writes[0].data[0].id, writes[1].data[0].id);
    assert.equal(writes[0].data[0].adminId, null);
    assert.equal(writes[0].data[0].targetType, 'ModelReview');
    assert.ok(!(writes[0].data[0].metadata as { contentText: string }).contentText.includes('{'));
    const reviewId = String(writes[0].data[0].id);
    let sql = '';
    const notificationDatabase = {
      $queryRaw: async (strings: TemplateStringsArray) => { sql = strings.join('?'); return []; },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
        adminAuditLog: { ...database.adminAuditLog, findUnique: async () => ({ targetType: 'ModelReview', adminId: null }) },
      }),
    } as unknown as PrismaClient;
    await listReportNotifications(1, 20, notificationDatabase);
    assert.match(sql, /ModelReview/);
    assert.match(sql, /ModelReviewRead/);
    assert.equal(await acknowledgeReportNotification(reviewId, 'verified-admin', notificationDatabase), true);
    assert.equal(writes.at(-1)?.data[0].targetType, 'ModelReviewRead');
    assert.equal(writes.at(-1)?.data[0].targetId, reviewId);
    assert.equal(writes.at(-1)?.skipDuplicates, true);
  } finally {
    if (previousMode === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousMode;
  }
});
