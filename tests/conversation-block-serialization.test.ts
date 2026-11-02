import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { addConversationMessage, blockConversationUser, unblockConversationUser } from '@/agent/marketplace/repository';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(t: TestContext) {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const record = { id: 'conversation', buyerId: 'buyer', sellerId: 'seller', listingId: 'listing', status: 'open',
    createdAt: new Date(0), updatedAt: new Date(0), messages: [], listing: null };
  type Block = { id: string; blockerId: string; blockedId: string; conversationId: string; reason: null; createdAt: Date };
  let block: Block | null = null;
  const events: string[] = [];
  let inserted = 0;
  let enqueued = 0;
  let beforeEnsure: ((id: string) => Promise<void>) | undefined;
  let beforeInsert: (() => Promise<void>) | undefined;
  const mutexes = new Map<string, Promise<void>>();
  const keys: string[] = [];
  function replace(target: object, key: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
  }
  const findBlock = async () => block;
  const upsertBlock = async ({ create }: { create: { blockerId: string; blockedId: string } }) => {
    block = { id: 'block', ...create, conversationId: record.id, reason: null, createdAt: new Date() };
    events.push('block'); return block;
  };
  const insertMessage = async ({ data }: { data: Record<string, unknown> }) => {
    await beforeInsert?.(); inserted++; events.push('message');
    return { id: 'message', ...data, createdAt: new Date() };
  };
  replace(prisma.user, 'upsert', async ({ where }: { where: { id: string } }) => { await beforeEnsure?.(where.id); return { id: where.id }; });
  replace(prisma.user, 'update', async ({ where }: { where: { id: string } }) => { await beforeEnsure?.(where.id); return { id: where.id }; });
  replace(prisma.conversation, 'findFirst', async () => structuredClone(record));
  replace(prisma.conversation, 'update', async () => record);
  replace(prisma.userBlock, 'findFirst', findBlock);
  replace(prisma.userBlock, 'upsert', upsertBlock);
  replace(prisma.conversationMessage, 'create', insertMessage);
  replace(prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => {
    const releases: Array<() => void> = [];
    let ownsPair = false;
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join('?').includes('771207')) {
          const key = String(values[0]); keys.push(key);
          const previous = mutexes.get(key) ?? Promise.resolve();
          const next = deferred(); mutexes.set(key, next.promise);
          await previous; ownsPair = true; releases.push(next.resolve);
        }
        return 1;
      },
      conversation: {
        findFirst: async () => { assert.ok(ownsPair); return structuredClone(record); },
        updateMany: async () => { assert.ok(ownsPair); return { count: record.status === 'open' ? 1 : 0 }; },
      },
      userBlock: {
        findFirst: async () => { assert.ok(ownsPair); return findBlock(); },
        findUnique: async () => { assert.ok(ownsPair); return block; },
        upsert: async (args: Parameters<typeof upsertBlock>[0]) => { assert.ok(ownsPair); return upsertBlock(args); },
        delete: async () => { assert.ok(ownsPair); block = null; },
      },
      conversationMessage: { create: insertMessage },
      notificationDeliveryJob: { upsert: async () => { enqueued++; } },
    };
    try { return await work(tx); } finally { releases.forEach(release => release()); }
  });
  return {
    record, events, keys,
    pauseEnsure: (value: typeof beforeEnsure) => { beforeEnsure = value; },
    pauseInsert: (value: typeof beforeInsert) => { beforeInsert = value; },
    inserted: () => inserted, enqueued: () => enqueued,
  };
}

for (const sender of ['buyer', 'seller']) {
  test(`a ${sender} send that passed its preflight cannot commit after the other participant blocks`, async t => {
    const state = fixture(t);
    const entered = deferred(); const resume = deferred();
    state.pauseEnsure(async id => { if (id === sender) { entered.resolve(); await resume.promise; } });
    const pending = addConversationMessage('conversation', sender, 'A local concurrency test message');
    await entered.promise;
    const blocker = sender === 'buyer' ? 'seller' : 'buyer';
    assert.equal((await blockConversationUser('conversation', blocker)).status, 'blocked');
    resume.resolve();
    const result = await pending;
    assert.equal(result.status, 'conversation_blocked');
    assert.equal(result.message, null);
    assert.equal(state.inserted(), 0); assert.equal(state.enqueued(), 0);
    assert.deepEqual(state.events, ['block']);
  });
}

test('a block waits for an already locked send, then prevents the next message in either direction', async t => {
  const state = fixture(t);
  const entered = deferred(); const resume = deferred();
  state.pauseInsert(async () => { entered.resolve(); await resume.promise; });
  const pending = addConversationMessage('conversation', 'buyer', 'A local ordered test message');
  await entered.promise;
  let blocked = false;
  const block = blockConversationUser('conversation', 'seller').then(result => { blocked = true; return result; });
  await flush(); assert.equal(blocked, false, 'block completion must follow the protected send commit');
  resume.resolve();
  assert.equal((await pending).status, 'sent'); assert.equal((await block).status, 'blocked');
  assert.deepEqual(state.events, ['message', 'block']);
  assert.equal(state.enqueued(), 1);
  assert.equal((await addConversationMessage('conversation', 'seller', 'A blocked reverse message')).status, 'conversation_blocked');
  assert.equal(state.inserted(), 1);
  assert.equal(new Set(state.keys).size, 1, 'sending and blocking share the same symmetric pair key');
  assert.equal((await unblockConversationUser('conversation', 'seller')).status, 'unblocked');
  state.pauseInsert(undefined);
  assert.equal((await addConversationMessage('conversation', 'buyer', 'Allowed after unblock')).status, 'sent');
  assert.equal(state.inserted(), 2);
});

test('a conversation closed after the initial read cannot accept the pending send', async t => {
  const state = fixture(t); const entered = deferred(); const resume = deferred();
  state.pauseEnsure(async () => { entered.resolve(); await resume.promise; });
  const pending = addConversationMessage('conversation', 'buyer', 'A local closing test message');
  await entered.promise; state.record.status = 'closed'; resume.resolve();
  assert.equal((await pending).status, 'conversation_closed');
  assert.equal(state.inserted(), 0); assert.equal(state.enqueued(), 0);
});
