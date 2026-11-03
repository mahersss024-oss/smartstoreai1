import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GET, POST } from '@/app/api/admin/recovery/route';
import { createSessionCookie } from '@/lib/auth/session';
import { getRecoveryEmergencyPlan } from '@/lib/recovery/emergency-plan';

const endpoint = 'https://souqhamad.com/api/admin/recovery';
test('an offline emergency plan follows an approved recovery source without including connection secrets', () => {
  const source = 'souqhamad-recovery-12345678901234567890';
  const plan = getRecoveryEmergencyPlan({ SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER: source,
    SMARTSTORE_RECOVERY_AWS_REGION: 'eu-central-1', DATABASE_URL: 'postgresql://private-secret@example/db' });
  assert.equal(plan.sourceDatabase, source); assert.doesNotMatch(JSON.stringify(plan), /private-secret|postgresql:/);
  assert.equal(getRecoveryEmergencyPlan({ SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER: 'invalid/source' }).sourceDatabase, 'smartstore-db');
});
function request(method: string, email?: string, body?: unknown, origin?: string) {
  return new Request(endpoint, { method, headers: {
    ...(email ? { cookie: createSessionCookie({ id: `recovery-route:${email}`, email, name: 'Synthetic operator', role: 'admin' }) } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(origin ? { origin } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function environment(t: TestContext) {
  const keys = ['AUTH_SECRET', 'SMARTSTORE_ADMIN_EMAILS', 'SMARTSTORE_RECOVERY_ENABLED',
    'SMARTSTORE_RECOVERY_SECURITY_GROUP_IDS', 'SMARTSTORE_RECOVERY_DB_SUBNET_GROUP',
    'SMARTSTORE_RECOVERY_MEDIA_ORIGIN', 'SMARTSTORE_RECOVERY_MEDIA_SECRET', 'SMARTSTORE_RECOVERY_MEDIA_ENABLED'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.AUTH_SECRET = 'owner-recovery-route-test-secret-with-ample-length';
  process.env.SMARTSTORE_ADMIN_EMAILS = 'recovery-owner@example.test';
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('recovery read, write and emergency download require a signed configured-owner session', async t => {
  environment(t);
  for (const handler of [GET, POST]) {
    const method = handler === GET ? 'GET' : 'POST';
    const guest = await handler(request(method));
    assert.equal(guest.status, 401);
    assert.equal((await guest.json()).error, 'auth_required');
    const admin = await handler(request(method, 'appointed-admin@example.test'));
    assert.equal(admin.status, 403);
    assert.equal((await admin.json()).error, 'owner_required');
  }
  const denied = await GET(new Request(`${endpoint}?download=plan`));
  assert.equal(denied.status, 401);
});

test('an unconfigured owner recovery console returns honest unavailable capabilities without external requests', async t => {
  environment(t);
  const result = await GET(request('GET', 'recovery-owner@example.test'));
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  const body = await result.json();
  assert.equal(body.rds.readStatus, 'not_configured');
  assert.equal(body.media.readStatus, 'not_configured');
  assert.deepEqual(body.capabilities, { databaseRestore: false, databaseVerify: false, mediaBackup: false, mediaRestore: false });
  assert.equal(body.productionCutoverAllowed, false);
  assert.ok(body.requiredConfiguration.includes('SMARTSTORE_RECOVERY_MEDIA_SECRET'));
  assert.doesNotMatch(JSON.stringify(body), /owner-recovery-route-test-secret|postgresql:\/\//);
});

test('emergency plan is downloadable without database queries, secrets, automatic cutover or SQL execution', async t => {
  environment(t);
  const req = request('GET', 'recovery-owner@example.test');
  const result = await GET(new Request(`${endpoint}?download=plan`, req));
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-disposition') ?? '', /attachment/);
  const plan = await result.json();
  assert.equal(plan.automaticProductionCutover, false);
  assert.equal(plan.checks.tombstoneReconciliationRequired, true);
  assert.ok(plan.steps.some((step: string) => step.includes('إذا تعذّر دخول لوحة المالك')));
  assert.doesNotMatch(JSON.stringify(plan), /owner-recovery-route-test-secret|postgresql:\/\//);
});

test('recovery mutation refuses cross-site requests and browser-supplied endpoints, SQL and cloud overrides', async t => {
  environment(t);
  const crossSite = await POST(request('POST', 'recovery-owner@example.test', { action: 'start_media_backup' }, 'https://evil.example'));
  assert.equal(crossSite.status, 403);
  for (const payload of [
    { action: 'verify_database', targetId: 'smartstore-db' },
    { action: 'verify_database', targetId: 'souqhamad-recovery-12345678901234567890', endpoint: 'https://evil.example' },
    { action: 'preview_restore', mode: 'snapshot', snapshotId: 'snapshot', databaseUrl: 'postgresql://secret@remote/db' },
    { action: 'execute_sql', sql: 'DELETE FROM User' },
    { action: 'cutover', targetId: 'souqhamad-recovery-12345678901234567890' },
    { action: 'restore_media', requestId: crypto.randomUUID(), backupId: crypto.randomUUID(), confirmation: 'استعادة ملفات إلى العزل', reason: 'Synthetic test', overwrite: true },
  ]) {
    const result = await POST(request('POST', 'recovery-owner@example.test', payload));
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error, 'recovery_request_invalid');
  }
});

test('recovery media actions fail closed without provisioned independent recovery resources', async t => {
  environment(t);
  const result = await POST(request('POST', 'recovery-owner@example.test', {
    action: 'start_media_backup', requestId: crypto.randomUUID(), reason: 'Synthetic fixture recovery',
  }));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, 'recovery_media_not_configured');
  assert.match(result.headers.get('cache-control') ?? '', /no-store/);
});
