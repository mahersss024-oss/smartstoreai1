import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GET, POST, PUT, PATCH, DELETE } from '@/app/api/admin/recovery/route';
import { createSessionCookie } from '@/lib/auth/session';
import { getRecoveryEmergencyPlan } from '@/lib/recovery/emergency-plan';
import { prisma } from '@/lib/db/prisma';

const endpoint = 'https://souqhamad.com/api/admin/recovery';
const mutations = [['POST', POST], ['PUT', PUT], ['PATCH', PATCH], ['DELETE', DELETE]] as const;
function request(method: string, email?: string, body?: unknown) {
  return new Request(endpoint, { method, headers: {
    ...(email ? { cookie: createSessionCookie({ id: `recovery-route:${email}`, email, name: 'Synthetic operator', role: 'admin' }) } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function environment(t: TestContext) {
  const values: Record<string, string | undefined> = {
    AUTH_SECRET: 'owner-recovery-route-test-secret-with-ample-length',
    SMARTSTORE_ADMIN_EMAILS: 'recovery-owner@example.test',
    SMARTSTORE_RECOVERY_ENABLED: undefined, SMARTSTORE_RECOVERY_SECURITY_GROUP_IDS: undefined,
    SMARTSTORE_RECOVERY_DB_SUBNET_GROUP: undefined, SMARTSTORE_RECOVERY_MEDIA_ORIGIN: undefined,
    SMARTSTORE_RECOVERY_MEDIA_SECRET: undefined, SMARTSTORE_RECOVERY_MEDIA_ENABLED: undefined,
    SMARTSTORE_RECOVERY_MONITORING_ENABLED: undefined,
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
  };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('an offline emergency plan follows an approved recovery source without including connection secrets', () => {
  const source = 'souqhamad-recovery-12345678901234567890';
  const plan = getRecoveryEmergencyPlan({ SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER: source,
    SMARTSTORE_RECOVERY_AWS_REGION: 'eu-central-1', DATABASE_URL: 'postgresql://private-secret@example/db' });
  assert.equal(plan.sourceDatabase, source); assert.doesNotMatch(JSON.stringify(plan), /private-secret|postgresql:/);
  assert.equal(getRecoveryEmergencyPlan({ SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER: 'invalid/source' }).sourceDatabase, 'smartstore-db');
});

test('recovery monitoring and all retired methods retain configured-owner authorization', async t => {
  environment(t);
  for (const [method, handler] of [['GET', GET], ...mutations] as const) {
    const guest = await handler(request(method));
    assert.equal(guest.status, 401); assert.equal((await guest.json()).error, 'auth_required');
    const admin = await handler(request(method, 'appointed-admin@example.test'));
    assert.equal(admin.status, 403); assert.equal((await admin.json()).error, 'owner_required');
    assert.match(admin.headers.get('cache-control') ?? '', /no-store/);
  }
  assert.equal((await GET(new Request(`${endpoint}?download=plan`))).status, 401);
});

test('unconfigured recovery monitoring returns no executable capabilities or authorization tokens', async t => {
  environment(t);
  const result = await GET(request('GET', 'recovery-owner@example.test'));
  assert.equal(result.status, 200); assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  const body = await result.json();
  assert.equal(body.monitoringOnly, true);
  assert.deepEqual(body.capabilities, { databaseRestore: false, databaseVerify: false, mediaBackup: false, mediaRestore: false });
  assert.equal(body.productionCutoverAllowed, false);
  assert.doesNotMatch(JSON.stringify(body), /owner-recovery-route-test-secret|postgresql:\/\/|previewToken/);
});

test('legacy restore, verification, backup and arbitrary operations are denied even with legacy flags enabled', async t => {
  environment(t);
  process.env.SMARTSTORE_RECOVERY_ENABLED = '1'; process.env.SMARTSTORE_RECOVERY_MEDIA_ENABLED = '1';
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_write'); });
  const cloud = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected_cloud_request'); });
  const operations = [
    { action: 'preview_restore', mode: 'snapshot', snapshotId: 'existing-snapshot' },
    { action: 'restore_database', previewToken: 'previously-issued-token', confirmation: 'استعادة نسخة منفصلة', reason: 'old saved request', costAcknowledged: true },
    { action: 'verify_database', targetId: 'souqhamad-recovery-12345678901234567890' },
    { action: 'start_media_backup', requestId: crypto.randomUUID(), reason: 'old saved request' },
    { action: 'restore_media', requestId: crypto.randomUUID(), backupId: crypto.randomUUID(), confirmation: 'استعادة ملفات إلى العزل', reason: 'old saved request' },
    { action: 'media_status', operationId: crypto.randomUUID(), kind: 'backup' },
    { action: 'execute_sql', sql: 'DELETE FROM "User"' },
    { action: 'cutover', targetId: 'production' },
  ];
  for (const [method, handler] of mutations) for (const operation of operations) {
    const result = await handler(request(method, 'recovery-owner@example.test', operation));
    assert.equal(result.status, 403); assert.equal((await result.json()).error, 'recovery_read_only');
    assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  }
  const unreadable = request('POST', 'recovery-owner@example.test');
  Object.defineProperty(unreadable, 'json', { value: () => { throw new Error('body_must_not_be_read'); } });
  assert.equal((await POST(unreadable)).status, 403);
  assert.equal(transaction.mock.callCount(), 0); assert.equal(cloud.mock.callCount(), 0);
});

test('the emergency plan remains a private GET download rather than a cloud operation', async t => {
  environment(t);
  const result = await GET(new Request(`${endpoint}?download=plan`, request('GET', 'recovery-owner@example.test')));
  assert.equal(result.status, 200); assert.match(result.headers.get('content-disposition') ?? '', /attachment/);
  const plan = await result.json();
  assert.equal(plan.automaticProductionCutover, false);
  assert.ok(plan.steps.some((step: string) => step.includes('إذا تعذّر دخول لوحة المالك')));
  assert.doesNotMatch(JSON.stringify(plan), /owner-recovery-route-test-secret|postgresql:\/\//);
});
