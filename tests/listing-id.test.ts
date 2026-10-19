import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Prisma } from '@prisma/client';
import { createListingId } from '@/lib/marketplace/listing-id';
import { createListingDraft as createDraft, getListing } from '@/agent/marketplace/repository';
import { createListingDraft, listSellerListings, setListingStatusForSeller } from '@/agent/marketplace/store';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { prisma } from '@/lib/db/prisma';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

const unifiedId = /^c[a-z0-9]{24}$/;
const input = { category: 'other', title: 'Desk', autoCategory: false };

function useStore(t: TestContext, mode: string) {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = mode;
  t.after(() => {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  });
}

test('new manual and chat IDs share one opaque shape with actor-scoped retry identity', () => {
  const ids = Array.from({ length: 1000 }, () => createListingId('seller'));
  assert.ok(ids.every(id => unifiedId.test(id)));
  assert.equal(new Set(ids).size, ids.length);
  const id = createListingId('seller', 'operation');
  assert.match(id, unifiedId);
  assert.equal(id, createListingId('seller', 'operation'));
  assert.notEqual(id, createListingId('other-seller', 'operation'));
  assert.notEqual(id, createListingId('seller', 'other-operation'));
});

test('file creation uses unified IDs, deduplicates concurrent chat retries and preserves old records', async t => {
  mockAllowedTextAnalysis(t);
  useStore(t, 'file');
  const user = { id: 'unified-file-seller', email: 'unified-file@example.test' };
  const manual = await createDraft(user, input);
  const attempts = await Promise.all(Array.from({ length: 4 }, () => createDraft(user, input, { idempotencyKey: 'concurrent' })));
  assert.match(manual.id, unifiedId);
  assert.ok(attempts.every(draft => unifiedId.test(draft.id) && draft.id === attempts[0].id));
  assert.equal(listSellerListings(user.id).length, 2);
  assert.equal((await createDraft(user, { ...input, title: 'Changed wording' }, { idempotencyKey: 'concurrent' })).title, 'Desk');
  assert.match(createListingDraft({ sellerId: 'direct-store-seller', ...input }).id, unifiedId);

  const legacy = createListingDraft({ id: 'chat-draft-existing-operation', sellerId: user.id, ...input });
  setListingStatusForSeller(legacy.id, user.id, 'published');
  const before = structuredClone(legacy);
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Replays must not re-analyze'); });
  const replay = await createDraft(user, { ...input, title: 'Not a replacement' }, { idempotencyKey: 'existing-operation' });
  assert.deepEqual(replay, before);
  assert.deepEqual(await getListing(legacy.id), before);
  assert.equal(listSellerListings(user.id).length, 3);
  assert.equal(analyze.mock.callCount(), 0);
  await assert.rejects(createDraft({ id: 'different-seller', email: 'different@example.test' }, input, { idempotencyKey: 'existing-operation' }), /ownership mismatch/);
});

test('the chat tool creates unified IDs and retries the same operation without changing its identity', async t => {
  mockAllowedTextAnalysis(t);
  useStore(t, 'file');
  const session = { user: { id: 'unified-tool-seller', email: 'unified-tool@example.test' }, issuedAt: 1, expiresAt: 9999999999 };
  const create = async (title: string) => {
    const tools = createMarketplaceTools(session, { requestKey: 'one-user-turn' });
    const execute = tools.createListingDraft.execute as unknown as (
      input: { category: string; title: string }, options: Record<string, never>,
    ) => Promise<{ status: string; listing: { id: string; status: string } }>;
    return execute({ category: 'other', title }, {});
  };
  const created = await create('Desk');
  const retried = await create('Rephrased desk');
  assert.equal(created.status, 'draft_created');
  assert.equal(created.listing.status, 'draft');
  assert.match(created.listing.id, unifiedId);
  assert.equal(retried.listing.id, created.listing.id);
  assert.equal(listSellerListings(session.user.id).length, 1);
});

for (const conflict of ['P2002', 'P2034']) {
  test(`database creation supplies unified IDs and safely retries ${conflict} without another draft`, async t => {
    mockAllowedTextAnalysis(t);
    useStore(t, 'database');
    const user = { id: `unified-db-${conflict}`, email: `unified-db-${conflict}@example.test` };
    const records = new Map<string, Record<string, unknown>>();
    const supplied: string[] = [];
    const originalUpsert = prisma.user.upsert;
    const originalFind = prisma.listing.findUnique;
    prisma.user.upsert = (async () => user) as unknown as typeof prisma.user.upsert;
    prisma.listing.findUnique = (async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null) as unknown as typeof prisma.listing.findUnique;
    t.after(() => { prisma.user.upsert = originalUpsert; prisma.listing.findUnique = originalFind; });
    const transaction = t.mock.method(prisma, '$transaction', async (callback: (tx: unknown) => Promise<unknown>) => callback({ listing: {
      findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null,
      count: async () => records.size,
      create: async ({ data }: { data: Record<string, unknown> & { id: string } }) => {
        supplied.push(data.id);
        if (supplied.length === 1) throw new Prisma.PrismaClientKnownRequestError('Synthetic conflict', { code: conflict, clientVersion: 'test' });
        const record = { ...data, createdAt: new Date(), updatedAt: new Date(), images: [], views: 0, messageCount: 0, favoriteCount: 0 };
        records.set(data.id, record);
        return record;
      },
    } }));
    const draft = await createDraft(user, input, { idempotencyKey: 'one-operation' });
    assert.match(draft.id, unifiedId);
    assert.equal(draft.status, 'draft');
    assert.equal(transaction.mock.callCount(), 2);
    assert.deepEqual(supplied, [draft.id, draft.id]);
    const replay = await createDraft(user, { ...input, title: 'Reworded' }, { idempotencyKey: 'one-operation' });
    assert.equal(replay.id, draft.id);
    assert.equal(replay.title, 'Desk');
    assert.equal(records.size, 1);
    const manual = await createDraft(user, input);
    assert.match(manual.id, unifiedId);
    assert.notEqual(manual.id, draft.id);
    assert.equal(records.size, 2);
  });
}

test('database legacy replay returns the original URL identity without any write or model call', async t => {
  useStore(t, 'database');
  const record = { id: 'chat-draft-db-existing', sellerId: 'legacy-db-owner', category: 'other', title: 'Old desk',
    status: 'published', attributes: {}, createdAt: new Date(), updatedAt: new Date(), images: [] };
  const originalFind = prisma.listing.findUnique;
  prisma.listing.findUnique = (async ({ where }: { where: { id: string } }) => where.id === record.id ? record : null) as unknown as typeof prisma.listing.findUnique;
  t.after(() => { prisma.listing.findUnique = originalFind; });
  const write = t.mock.method(prisma, '$transaction', () => { throw new Error('Legacy replay cannot write'); });
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', () => { throw new Error('Legacy replay cannot call models'); });
  const listing = await createDraft({ id: record.sellerId, email: 'legacy@example.test' }, input, { idempotencyKey: 'db-existing' });
  assert.equal(listing.id, record.id);
  assert.equal(listing.title, record.title);
  assert.equal(listing.status, 'published');
  assert.equal(write.mock.callCount(), 0);
  assert.equal(analyze.mock.callCount(), 0);
});
