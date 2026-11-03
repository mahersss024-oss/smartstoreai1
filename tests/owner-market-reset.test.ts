import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { GET as readMaintenance, POST as runMaintenance } from '@/app/api/admin/maintenance/route';
import { executeMarketReset, getMarketResetPreview, MarketResetError, marketResetConfirmation,
  signMarketResetPreview, verifyMarketResetPreview } from '@/lib/admin/market-reset';
import { createSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

const environment: Record<string, string | undefined> = {
  NODE_ENV: 'production', SMARTSTORE_MARKETPLACE_STORE: 'database',
  AUTH_SECRET: 'isolated-retired-owner-market-reset-test-secret',
  SMARTSTORE_ADMIN_EMAILS: 'reset-owner@example.test', DATABASE_URL: undefined, DIRECT_URL: undefined,
  SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
};
async function withEnvironment(values: Record<string, string | undefined>, work: () => Promise<void>) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { await work(); }
  finally { for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } }
}
const denied = (error: unknown) => error instanceof MarketResetError && error.code === 'maintenance_read_only' && error.status === 403;
const payload = { action: 'market_reset', confirmation: marketResetConfirmation, reason: 'Legacy reset request',
  previewToken: 'previously-issued-preview', backupConfirmed: true, includeProtectedData: true };
function request(email: string | null, role = 'user', body?: unknown) {
  return new Request('https://smartstore.test/api/admin/maintenance?resource=market_reset', {
    method: body === undefined ? 'GET' : 'POST', headers: {
      ...(email ? { cookie: createSessionCookie({ id: `google:${email}`, email, role }) } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('retired full reset rejects direct execution before database access even with complete old acknowledgements', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected_external_request'); });
  await withEnvironment(environment, async () => {
    for (const flag of ['0', '1', 'true', undefined]) {
      await withEnvironment({ SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: flag,
        SMARTSTORE_RECOVERY_ENABLED: flag }, async () => {
        await assert.rejects(executeMarketReset({ ...payload, actorId: 'configured-owner' }), denied);
        await assert.rejects(executeMarketReset(undefined as unknown as Parameters<typeof executeMarketReset>[0]), denied);
        await assert.rejects(getMarketResetPreview('configured-owner'), denied);
      });
    }
  });
  assert.equal(transaction.mock.callCount(), 0); assert.equal(network.mock.callCount(), 0);
});

test('retired reset neither issues nor accepts signed or replayed legacy preview tokens', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withEnvironment(environment, async () => {
    const claim = { actorId: 'configured-owner', asOf: Date.now(), fingerprint: 'a'.repeat(64) };
    const body = Buffer.from(JSON.stringify({ ...claim, purpose: 'owner-market-reset-v1' })).toString('base64url');
    const legacyToken = `${body}.${createHmac('sha256', process.env.AUTH_SECRET!).update(`owner-market-reset-v1:${body}`).digest('base64url')}`;
    assert.throws(() => signMarketResetPreview(claim), denied);
    for (const token of [legacyToken, 'forged', '', 'x'.repeat(3000)]) {
      assert.throws(() => verifyMarketResetPreview(token, claim.actorId), denied);
      await assert.rejects(executeMarketReset({ ...payload, actorId: claim.actorId, previewToken: token }), denied);
    }
    await withEnvironment({ AUTH_SECRET: undefined }, async () => {
      assert.throws(() => signMarketResetPreview(claim), denied);
      assert.throws(() => verifyMarketResetPreview(legacyToken, claim.actorId), denied);
      await assert.rejects(getMarketResetPreview(claim.actorId), denied);
    });
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('retired full-reset HTTP endpoints retain signed owner authentication without accessing persistence', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withEnvironment(environment, async () => {
    for (const actor of [
      { email: null, role: 'user', status: 401, error: 'auth_required' },
      { email: 'customer-reset@example.test', role: 'user', status: 403, error: 'owner_required' },
      { email: 'moderator-reset@example.test', role: 'moderator', status: 403, error: 'owner_required' },
      { email: 'appointed-admin@example.test', role: 'admin', status: 403, error: 'owner_required' },
      { email: 'fake-owner-reset@example.test', role: 'owner', status: 403, error: 'owner_required' },
    ]) for (const response of [await readMaintenance(request(actor.email, actor.role)),
      await runMaintenance(request(actor.email, actor.role, payload))]) {
      assert.equal(response.status, actor.status); assert.equal((await response.json()).error, actor.error);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('configured owners cannot reactivate a full market wipe by mode, flags, legacy body or selected resource', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withEnvironment(environment, async () => {
    for (const store of ['database', 'file', 'memory']) for (const flag of ['0', '1', 'true']) {
      await withEnvironment({ SMARTSTORE_MARKETPLACE_STORE: store,
        SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: flag }, async () => {
        for (const response of [await readMaintenance(request('reset-owner@example.test', 'admin')),
          await runMaintenance(request('reset-owner@example.test', 'admin', payload)),
          await runMaintenance(request('reset-owner@example.test', 'owner', { ...payload, actorId: 'browser-chosen-owner', model: 'User' }))]) {
          assert.equal(response.status, 403); assert.equal((await response.json()).error, 'maintenance_read_only');
          assert.match(response.headers.get('cache-control') ?? '', /no-store/);
        }
      });
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
});
