import assert from 'node:assert/strict';
import test, { beforeEach, type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';
import sharp from 'sharp';

import { PATCH, DELETE } from '@/app/api/account/profile/route';
import { POST as uploadPicture, DELETE as removePicture } from '@/app/api/account/profile/picture/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

const identity = { id: 'profile-lifecycle', email: 'lifecycle@example.test', name: 'Before' };
type Account = typeof identity & { picture: string | null; role: string; deletedAt: Date | null; phoneNumber: string | null };
let accountSequence = 0;
beforeEach(() => {
  identity.id = `profile-lifecycle-${++accountSequence}`;
  identity.email = `lifecycle-${accountSequence}@example.test`;
});
type Commission = { id: string; sellerId: string; status: string; amount: number };
const account = (updates: Partial<Account> = {}): Account => ({ ...identity, picture: null, role: 'user', deletedAt: null, phoneNumber: null, ...updates });

function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}

// Actual route handlers with an in-memory Prisma boundary. No remote database,
// model service or image storage is contacted by this regression suite.
function database(t: TestContext, initial = [account()], commissions: Commission[] = []) {
  const env = {
    AUTH_SECRET: 'account-lifecycle-test-secret-with-enough-length',
    SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
    SMARTSTORE_IMAGE_STORAGE: 's3', SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://test-only.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'profile-fixtures', SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'fake-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'fake-secret', SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://test-images.example.invalid',
    CLOUDFLARE_API_TOKEN: 'fake-token', CLOUDFLARE_ZONE_ID: 'fake-zone',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const users = new Map(initial.map(user => [user.id, { ...user }]));
  const ledger = commissions.map(item => ({ ...item }));
  const writes: string[] = [];
  const locks: string[] = [];
  const audits: Array<{ metadata: Record<string, unknown> }> = [];
  const cleanups = new Map<string, Record<string, unknown>>();
  const state = { transactionAttempts: 0, serializationConflicts: 0, retention: false,
    conflict: { code: 'P2034', meta: undefined as { code: string } | undefined } };
  const find = (where: { id?: string; email?: string }) => {
    const user = where.id ? users.get(where.id) : [...users.values()].find(user => user.email === where.email);
    return user ? { ...user } : null;
  };
  const db = {
    $executeRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return 1; },
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => find(where),
      findFirst: async ({ where }: { where: { id?: string; OR?: Array<{ id?: string; email?: string }> } }) =>
        where.OR ? where.OR.map(find).find(Boolean) ?? null : find(where),
      count: async ({ where }: { where: { id: string; picture?: { in: string[] } } }) => {
        const user = users.get(where.id);
        return user && (!where.picture || where.picture.in.includes(user.picture ?? '')) ? 1 : 0;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Account> }) => {
        const current = users.get(where.id);
        assert.ok(current, 'A profile write must never create a missing account.');
        const next = { ...current, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
        users.set(where.id, next);
        writes.push(`user:update:${where.id}`);
        return next;
      },
      upsert: async () => { throw new Error('Account creation is forbidden in profile routes.'); },
      delete: async ({ where }: { where: { id: string } }) => {
        users.delete(where.id); writes.push(`user:delete:${where.id}`);
        for (let index = ledger.length - 1; index >= 0; index--) if (ledger[index].sellerId === where.id) ledger.splice(index, 1);
        return {};
      },
    },
    listing: {
      findMany: async () => [{ id: 'owned-listing' }],
      updateMany: async () => { writes.push('listings:hidden'); return { count: 1 }; },
    },
    conversation: { updateMany: async () => { writes.push('conversations:closed'); return { count: 1 }; } },
    pushSubscription: { deleteMany: async () => { writes.push('browser-push:removed'); return { count: 1 }; } },
    mobilePushToken: { deleteMany: async () => { writes.push('native-push:removed'); return { count: 1 }; } },
    commission: { findFirst: async ({ where }: { where: { sellerId: string } }) => ledger.find(item => item.sellerId === where.sellerId) ?? null },
    evidenceAsset: { count: async () => 0 },
    evidenceCase: { findFirst: async () => state.retention ? { id: 'case' } : null },
    adminAuditLog: { create: async ({ data }: { data: { metadata: Record<string, unknown> } }) => { audits.push(data); return data; } },
    imageObjectCleanup: {
      upsert: async ({ where, create }: { where: { imageId: string }; create: Record<string, unknown> }) => {
        const value = cleanups.get(where.imageId) ?? { id: where.imageId, attempts: 0, leaseUntil: null, nextAttemptAt: new Date(0), cleanupAt: null, ...create };
        cleanups.set(where.imageId, value); return value;
      },
      findUnique: async ({ where }: { where: { imageId: string } }) => cleanups.get(where.imageId) ?? null,
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = cleanups.get(where.id); if (!current) return { count: 0 };
        cleanups.set(where.id, { ...current, ...data }); return { count: 1 };
      },
    },
  };
  const replace = (target: object, key: string, value: unknown) => {
    const record = target as Record<string, unknown>; const original = record[key]; record[key] = value;
    t.after(() => { record[key] = original; });
  };
  for (const name of ['user', 'listing', 'conversation', 'pushSubscription', 'mobilePushToken', 'commission', 'evidenceCase', 'evidenceAsset', 'adminAuditLog', 'imageObjectCleanup'] as const) {
    for (const [key, value] of Object.entries(db[name])) replace(prisma[name], key, value);
  }
  replace(prisma, '$transaction', async (work: (tx: Prisma.TransactionClient) => unknown) => {
    state.transactionAttempts++;
    if (state.serializationConflicts-- > 0) throw Object.assign(new Error('serialization conflict'), state.conflict);
    return work(db as unknown as Prisma.TransactionClient);
  });
  const requests: Array<{ host: string; method: string }> = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ host: new URL(String(input)).hostname, method: init?.method ?? 'GET' });
    throw new Error('Unexpected external access refused.');
  });
  return { users, ledger, writes, locks, audits, state, requests, cleanups };
}

function request(method: string, body?: unknown) {
  return new Request('https://example.test/api/account/profile', {
    method, headers: { Authorization: `Bearer ${createSignedSession(identity)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

for (const status of ['due', 'pending_amount', 'paid', 'waived', 'disputed']) {
  test(`self deletion retains ${status} financial history without an evidence case`, async t => {
    const initial = { id: 'commission', sellerId: identity.id, status, amount: 100 };
    const db = database(t, [account()], [initial]);
    const response = await DELETE(request('DELETE'));
    assert.equal(response.status, 200);
    assert.deepEqual(db.ledger, [initial]);
    assert.ok(db.users.get(identity.id)?.deletedAt instanceof Date);
    assert.ok(!db.writes.some(write => write.startsWith('user:delete:')));
    assert.ok(db.writes.includes('listings:hidden'));
    assert.ok(db.writes.includes('conversations:closed'));
    assert.ok(db.writes.includes('native-push:removed'));
    assert.equal(db.audits[0].metadata.financialRecordsRetained, true);
    assert.equal(db.audits[0].metadata.mode, 'retained');
    const listingLock = db.locks.findIndex(sql => /FROM "Listing".*FOR UPDATE/.test(sql));
    const userLock = db.locks.findIndex(sql => /FROM "User".*FOR UPDATE/.test(sql));
    assert.ok(listingLock >= 0 && userLock > listingLock);
    assert.deepEqual(db.requests, []);
  });
}

test('self deletion keeps permanent deletion for an account without evidence or financial history', async t => {
  const db = database(t);
  assert.equal((await DELETE(request('DELETE'))).status, 200);
  assert.equal(db.users.has(identity.id), false);
  assert.equal(db.audits[0].metadata.mode, 'permanent');
});

test('self deletion still retains protected evidence without a commission', async t => {
  const db = database(t); db.state.retention = true;
  assert.equal((await DELETE(request('DELETE'))).status, 200);
  assert.ok(db.users.get(identity.id)?.deletedAt);
  assert.equal(db.audits[0].metadata.protectedEvidence, true);
});

test('a profile PATCH delayed behind account deletion cannot recreate the account', async t => {
  const db = database(t); const started = deferred(); const resume = deferred();
  const update = request('PATCH', { displayName: 'After', phoneNumber: '' });
  update.json = async () => { started.resolve(); await resume.promise; return { displayName: 'After', phoneNumber: '' }; };
  const pending = PATCH(update); await started.promise;
  assert.equal((await DELETE(request('DELETE'))).status, 200);
  resume.resolve();
  const response = await pending;
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'auth_required');
  assert.equal(db.users.has(identity.id), false);
  assert.deepEqual(db.writes, [`user:delete:${identity.id}`]);
});

for (const deletedAt of [null, new Date('2026-10-29T00:00:00Z')]) {
  test(`a stale session cannot edit or delete the new account with its old email (${deletedAt ? 'retained' : 'missing'})`, async t => {
    const original = deletedAt ? [account({ deletedAt })] : [];
    const replacement = account({ id: 'new-registration', name: 'New account' });
    const db = database(t, [...original, replacement]);
    assert.equal((await PATCH(request('PATCH', { displayName: 'Wrong', phoneNumber: '' }))).status, 401);
    assert.equal((await removePicture(request('DELETE'))).status, 401);
    assert.equal((await DELETE(request('DELETE'))).status, 200);
    assert.deepEqual(db.users.get(replacement.id), replacement);
    assert.deepEqual(db.writes, []);
  });
}

test('active profile edits preserve identity and change only supplied profile data', async t => {
  const db = database(t);
  assert.equal((await PATCH(request('PATCH', { displayName: 'After', phoneNumber: '' }))).status, 200);
  assert.equal(db.users.get(identity.id)?.name, 'After');
  assert.equal(db.users.size, 1);
  assert.ok(db.locks.some(sql => /FROM "User".*FOR UPDATE/.test(sql)));
});

test('self deletion retries serialization conflicts before committing retention', async t => {
  const db = database(t, [account()], [{ id: 'fee', sellerId: identity.id, status: 'due', amount: 10 }]);
  db.state.serializationConflicts = 2;
  assert.equal((await DELETE(request('DELETE'))).status, 200);
  assert.equal(db.state.transactionAttempts, 3);
  assert.equal(db.audits.length, 1);
  assert.equal(db.ledger.length, 1);
});

for (const sqlState of ['40P01', '40001']) {
  test(`self deletion retries raw SQL concurrency conflicts ${sqlState}`, async t => {
    const db = database(t); db.state.serializationConflicts = 1;
    db.state.conflict = { code: 'P2010', meta: { code: sqlState } };
    assert.equal((await DELETE(request('DELETE'))).status, 200);
    assert.equal(db.state.transactionAttempts, 2);
  });
}

test('self deletion does not retry unrelated SQL failures', async t => {
  const db = database(t); db.state.serializationConflicts = 1;
  db.state.conflict = { code: 'P2010', meta: { code: '42501' } };
  await assert.rejects(DELETE(request('DELETE')), { code: 'P2010' });
  assert.equal(db.state.transactionAttempts, 1);
  assert.deepEqual(db.writes, []);
});

test('profile image preparation finishing after account deletion rejects its commit and cleans its uploaded object', async t => {
  const db = database(t); const transferred = deferred(); const resume = deferred();
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET';
    db.requests.push({ host: url.hostname, method });
    if (url.hostname === 'test-only.r2.cloudflarestorage.com' && method === 'PUT') {
      transferred.resolve(); await resume.promise; return new Response(null, { status: 200 });
    }
    if (url.hostname === 'test-images.example.invalid' && method === 'HEAD') return new Response(null, { headers: { 'Content-Type': 'image/jpeg' } });
    if (url.hostname === 'test-only.r2.cloudflarestorage.com' && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.hostname === 'api.cloudflare.com') return Response.json({ success: true });
    throw new Error('Unexpected external access refused.');
  });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const form = new FormData(); form.append('image', new File([new Uint8Array(image)], 'profile.jpg', { type: 'image/jpeg' }));
  const upload = uploadPicture(new Request('https://example.test/api/account/profile/picture', {
    method: 'POST', headers: { Authorization: `Bearer ${createSignedSession(identity)}` }, body: form,
  }));
  await transferred.promise;
  assert.equal((await DELETE(request('DELETE'))).status, 200);
  resume.resolve();
  const response = await upload;
  assert.equal(response.status, 401);
  assert.equal(db.users.has(identity.id), false);
  assert.ok(db.requests.some(item => item.method === 'DELETE'));
  assert.equal(db.cleanups.size, 1);
});
