import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { POST } from '@/app/api/marketplace/conversations/[conversationId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function fixture(t: TestContext) {
  for (const [key, value] of Object.entries({
    SMARTSTORE_MARKETPLACE_STORE: 'database', NODE_ENV: 'test',
    AUTH_SECRET: 'local-conversation-retry-only', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  type Receipt = { namespace: string; actorKey: string; key: string; status: string;
    updatedAt: Date; response: unknown; statusCode: number | null };
  type Message = { id: string; conversationId: string; senderId: string; body: string;
    status: string; type: string; metadata: object; reasons: string[]; createdAt: Date };
  const receipts = new Map<string, Receipt>();
  const messages = new Map<string, Message>();
  const jobs = new Set<string>();
  let failReceipt = false;
  const receiptKey = (v: Pick<Receipt, 'namespace' | 'actorKey' | 'key'>) => JSON.stringify([v.namespace, v.actorKey, v.key]);
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'create', async ({ data }: { data: Receipt }) => {
    if (receipts.has(receiptKey(data))) throw new Error('unique_key');
    const row = { ...data, status: 'pending', updatedAt: new Date(), response: null, statusCode: null };
    receipts.set(receiptKey(data), row); return row;
  });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'findUnique', async ({ where }: {
    where: { namespace_actorKey_key: Receipt };
  }) => structuredClone(receipts.get(receiptKey(where.namespace_actorKey_key)) ?? null));
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'update', async ({ where, data }: {
    where: { namespace_actorKey_key: Receipt }; data: Partial<Receipt>;
  }) => {
    if (failReceipt) { failReceipt = false; throw new Error('receipt_failed_after_message_commit'); }
    const row = receipts.get(receiptKey(where.namespace_actorKey_key)); assert.ok(row);
    Object.assign(row, data, { updatedAt: new Date() }); return row;
  });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'updateMany', async ({ where, data }: { where: Receipt; data: Partial<Receipt> }) => {
    const row = receipts.get(receiptKey(where));
    if (!row || row.status !== where.status || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
    Object.assign(row, data, { updatedAt: new Date() }); return { count: 1 };
  });
  const conversation = () => ({ id: 'retry-conversation', buyerId: 'retry-buyer', sellerId: 'retry-seller',
    listingId: 'retry-listing', status: 'open', messages: [...messages.values()],
    createdAt: new Date(0), updatedAt: new Date(), listing: null });
  mockDatabaseMethod(t, prisma.conversation, 'findFirst', async () => conversation());
  mockDatabaseMethod(t, prisma.userBlock, 'findFirst', async () => null);
  mockDatabaseMethod(t, prisma.userBlock, 'findMany', async () => []);
  mockDatabaseMethod(t, prisma.user, 'upsert', async () => ({ id: 'retry-buyer' }));
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    $executeRaw: async () => 1,
    conversation: { findFirst: async () => conversation(), updateMany: async () => ({ count: 1 }) },
    userBlock: { findFirst: async () => null },
    conversationMessage: {
      findUnique: async ({ where }: { where: { id: string } }) => messages.get(where.id) ?? null,
      create: async ({ data }: { data: Message }) => {
        assert.ok(!messages.has(data.id)); const row = { ...data, createdAt: new Date() };
        messages.set(row.id, row); return row;
      },
    },
    notificationDeliveryJob: { upsert: async ({ create }: { create: { id: string } }) => { jobs.add(create.id); return create; } },
  }));
  const request = (key: string, body = 'Local message retry', sender = 'retry-buyer') => POST(new Request('https://example.test/api/marketplace/conversations/retry-conversation', {
    method: 'POST', headers: { Authorization: `Bearer ${createSignedSession({ id: sender, email: sender + '@example.test' })}`,
      'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ body }),
  }), { params: Promise.resolve({ conversationId: 'retry-conversation' }) });
  return { request, receipts, messages, jobs, failNextReceipt: () => { failReceipt = true; } };
}

test('a committed message survives receipt failure and stale retry without a second message or outbox job', async t => {
  const f = fixture(t); f.failNextReceipt();
  await assert.rejects(f.request('lost-response'), /receipt_failed_after_message_commit/);
  assert.equal(f.messages.size, 1); assert.equal(f.jobs.size, 1);
  const original = [...f.messages.values()][0];
  for (const row of f.receipts.values()) row.updatedAt = new Date(Date.now() - 121_000);
  const response = await f.request('lost-response');
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, 'sent'); assert.equal(body.message.id, original.id);
  assert.equal('replayed' in body, false, 'internal replay state must not change the HTTP contract');
  assert.equal(f.messages.size, 1); assert.equal(f.jobs.size, 1);
  f.receipts.clear();
  assert.equal((await f.request('lost-response')).status, 201, 'receipt pruning must not remove source deduplication');
  assert.equal(f.messages.size, 1); assert.equal(f.jobs.size, 1);
});

test('message operation identities isolate actors and keys and leave separately sent messages distinct', async t => {
  const f = fixture(t);
  assert.equal((await f.request('same-key')).status, 201);
  assert.equal((await f.request('same-key', 'Seller response', 'retry-seller')).status, 201);
  assert.equal((await f.request('another-key')).status, 201);
  assert.equal(f.messages.size, 3); assert.equal(f.jobs.size, 3);
});

test('replaying a stored response uses current deletion state and stores no private conversation snapshot', async t => {
  const f = fixture(t);
  f.messages.set('shared-contact', { id: 'shared-contact', conversationId: 'retry-conversation',
    senderId: 'retry-seller', body: 'Private contact', status: 'sent', type: 'contact_share',
    metadata: { phoneNumber: '0501234567' }, reasons: [], createdAt: new Date() });
  const response = await f.request('private-replay');
  const first = await response.json();
  assert.ok(JSON.stringify(first).includes('0501234567'));
  const receipt = [...f.receipts.values()][0];
  assert.equal(JSON.stringify(receipt.response).includes('0501234567'), false);
  // Also check historical receipts written before this fix.
  receipt.response = first;
  const live = f.messages.get('shared-contact')!;
  live.type = 'message_deleted'; live.body = ''; live.metadata = {};
  const replay = await f.request('private-replay');
  assert.equal(replay.status, 201);
  const body = await replay.json();
  assert.equal(JSON.stringify(body).includes('0501234567'), false);
  assert.equal(body.conversation.messages.find((message: { id: string }) => message.id === live.id).type, 'message_deleted');
  f.messages.delete(first.message.id);
  assert.equal((await (await f.request('private-replay')).json()).message, null, 'hidden/deleted message is never restored from a receipt');
  assert.equal(f.jobs.size, 1);
});
