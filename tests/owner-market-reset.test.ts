import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { GET as readMaintenance, POST as runMaintenance } from '@/app/api/admin/maintenance/route';
import {
  executeMarketReset,
  MarketResetError,
  marketResetConfirmation,
  marketResetModels,
  signMarketResetPreview,
  verifyMarketResetPreview,
} from '@/lib/admin/market-reset';
import { signMaintenancePreview, verifyMaintenancePreview } from '@/lib/admin/maintenance';
import { createSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { normalizeMaintenanceConfirmation } from '@/lib/admin/maintenance-confirmation';

test('confirmation formatting accepts pasted spacing and direction marks while retaining the full destructive wording', () => {
  const decorated = `\u200f  ${marketResetConfirmation.split(' ').join('\u00a0  ')} \u200e`;
  assert.equal(normalizeMaintenanceConfirmation(decorated), marketResetConfirmation);
  assert.equal(normalizeMaintenanceConfirmation('  تنظيف\u061c  '), 'تنظيف');
  assert.notEqual(normalizeMaintenanceConfirmation('حذف بيانات السوق'), marketResetConfirmation);
  assert.notEqual(normalizeMaintenanceConfirmation('حذف بيانات السوق والابقاء على المستخدمين'), marketResetConfirmation);
});

const isolatedEnvironment: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  SMARTSTORE_MARKETPLACE_STORE: 'database',
  AUTH_SECRET: 'isolated-owner-market-reset-test-secret',
  SMARTSTORE_ADMIN_EMAILS: 'reset-owner@example.test',
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

async function withEnvironment(values: Record<string, string | undefined>, action: () => Promise<void>) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { await action(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const hasError = (code: string, status = 409) => (error: unknown) =>
  error instanceof MarketResetError && error.code === code && error.status === status;

function resetRequest(email: string | null, role: string, payload?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    ...(email ? { cookie: createSessionCookie({ id: `google:${email}`, email, role }) } : {}),
    ...(payload ? { 'content-type': 'application/json' } : {}),
  };
  return new Request('https://smartstore.test/api/admin/maintenance?resource=market_reset', {
    method: payload ? 'POST' : 'GET', headers, ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
}

const resetPayload = {
  action: 'market_reset', confirmation: marketResetConfirmation,
  reason: 'Remove pre-launch fixtures while retaining the account records',
  previewToken: 'invalid-preview', backupConfirmed: true, includeProtectedData: true,
};

test('full market reset inventory explicitly covers every model except preserved User accounts', () => {
  const actual: string[] = marketResetModels.map(model => model.kind);
  const expected = Prisma.dmmf.datamodel.models.map(model => model.name).filter(name => name !== 'User');
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual([...actual].sort(), expected.sort());
  assert.ok(!actual.some(name => name === 'User'));
  for (const retainedJob of ['ListingImageUpload', 'ImageObjectCleanup']) {
    assert.equal(marketResetModels.find(model => model.kind === retainedJob)?.mode, 'cleanup');
  }
});

test('market reset preview binds its actor, contents and ten-minute lifetime', async () => {
  await withEnvironment(isolatedEnvironment, async () => {
    const now = Date.now();
    const claim = { actorId: 'configured-owner', asOf: now, fingerprint: 'a'.repeat(64) };
    const token = signMarketResetPreview(claim);
    assert.deepEqual(verifyMarketResetPreview(token, claim.actorId, now), claim);
    assert.deepEqual(verifyMarketResetPreview(token, claim.actorId, now + 10 * 60_000), claim);
    for (const verify of [
      () => verifyMarketResetPreview(token, 'different-owner', now),
      () => verifyMarketResetPreview(token, claim.actorId, now - 1),
      () => verifyMarketResetPreview(token, claim.actorId, now + 10 * 60_000 + 1),
      () => verifyMarketResetPreview(`${token}tampered`, claim.actorId, now),
      () => verifyMarketResetPreview(`${token}.extra`, claim.actorId, now),
      () => verifyMarketResetPreview('x'.repeat(2001), claim.actorId, now),
      () => verifyMarketResetPreview(`${Buffer.from(JSON.stringify({ ...claim, fingerprint: 'b'.repeat(64) })).toString('base64url')}.${token.split('.')[1]}`, claim.actorId, now),
    ]) assert.throws(verify, hasError('preview_invalid'));
  });
});

test('full reset and bounded maintenance preview signatures cannot authorize each other', async () => {
  await withEnvironment(isolatedEnvironment, async () => {
    const now = Date.now();
    const claim = { actorId: 'same-owner', asOf: now, fingerprint: 'b'.repeat(64) };
    const bounded = signMaintenancePreview({ ...claim, scope: 'closed_reports' });
    const full = signMarketResetPreview(claim);
    assert.throws(() => verifyMarketResetPreview(bounded, claim.actorId, now), hasError('preview_invalid'));
    assert.throws(() => verifyMaintenancePreview(full, claim.actorId, 'closed_reports', now), /preview_invalid/);
  });
});

test('reset verification rejects signed malformed claims and wrong purpose', async () => {
  await withEnvironment(isolatedEnvironment, async () => {
    const now = Date.now();
    const valid = { actorId: 'owner', asOf: now, fingerprint: 'c'.repeat(64), purpose: 'owner-market-reset-v1' };
    for (const changes of [
      { asOf: Number.NaN }, { asOf: now + 0.5 }, { fingerprint: 'not-a-digest' },
      { fingerprint: 'c'.repeat(63) }, { purpose: 'bounded-cleanup' },
    ]) {
      const body = Buffer.from(JSON.stringify({ ...valid, ...changes })).toString('base64url');
      const signature = createHmac('sha256', process.env.AUTH_SECRET!).update(`owner-market-reset-v1:${body}`).digest('base64url');
      assert.throws(() => verifyMarketResetPreview(`${body}.${signature}`, valid.actorId, now), hasError('preview_invalid'));
    }
  });
});

test('market reset fails closed without its server signing secret', async () => {
  await withEnvironment({ ...isolatedEnvironment, AUTH_SECRET: undefined }, async () => {
    const claim = { actorId: 'owner', asOf: Date.now(), fingerprint: 'd'.repeat(64) };
    assert.throws(() => signMarketResetPreview(claim), hasError('maintenance_not_configured', 503));
    assert.throws(() => verifyMarketResetPreview('forged', claim.actorId), hasError('maintenance_not_configured', 503));
  });
});

test('the retired maintenance endpoint denies non-owners and returns gone to the configured owner', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withEnvironment(isolatedEnvironment, async () => {
    for (const actor of [
      { email: null, role: 'user', status: 401, error: 'auth_required' },
      { email: 'customer-reset@example.test', role: 'user', status: 403, error: 'owner_required' },
      { email: 'moderator-reset@example.test', role: 'moderator', status: 403, error: 'owner_required' },
      { email: 'admin-reset@example.test', role: 'admin', status: 403, error: 'owner_required' },
      { email: 'fake-owner-reset@example.test', role: 'owner', status: 403, error: 'owner_required' },
      { email: 'reset-owner@example.test', role: 'admin', status: 410, error: 'maintenance_retired' },
    ]) {
      const read = await readMaintenance(resetRequest(actor.email, actor.role));
      const write = await runMaintenance(resetRequest(actor.email, actor.role, resetPayload));
      for (const response of [
        read,
        write,
      ]) {
        assert.equal(response.status, actor.status);
        assert.equal((await response.json()).error, actor.error);
        assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      }
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('direct reset execution cannot start a transaction without the explicit destructive acknowledgements', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withEnvironment(isolatedEnvironment, async () => {
    for (const changed of [
      { confirmation: 'تنظيف' }, { backupConfirmed: false }, { includeProtectedData: false },
      { reason: 'tiny' }, { reason: 'a'.repeat(501) },
    ]) {
      await assert.rejects(executeMarketReset({ ...resetPayload, ...changed, actorId: 'owner' }), hasError('invalid_reset_request', 400));
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
});
