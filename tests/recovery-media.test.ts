import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRecoveryMediaRun, getRecoveryMediaStatus, recoveryMediaConfirmation,
  restoreRecoveryMedia, signRecoveryMediaRequest, startRecoveryMediaBackup } from '@/lib/recovery/media';

const secret = 'separate-recovery-worker-secret-for-test-only';
const origin = 'https://souqhamad-recovery.synthetic.workers.dev';
const now = Date.parse('2026-11-03T12:00:00Z');
const id = '218321e6-ed8a-4434-a07a-e8fe1f12554b';
const backupId = 'f4bf8e09-a148-4bd3-9fe5-0b1007c90b7a';
const env = { SMARTSTORE_RECOVERY_MEDIA_ORIGIN: origin, SMARTSTORE_RECOVERY_MEDIA_SECRET: secret,
  SMARTSTORE_RECOVERY_MEDIA_ENABLED: '1' };
const run = { runId: id, kind: 'backup', status: 'queued', createdAt: new Date(now).toISOString(), objects: 0, bytes: 0, errors: 0 };

test('unconfigured media recovery refuses cloud mutations and status has no fabricated backup readiness', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('Must never call a provider.'); };
  const status = await getRecoveryMediaStatus({ env: {}, fetcher });
  assert.equal(status.readStatus, 'not_configured');
  assert.equal(status.backupEnabled, false);
  assert.equal(status.productionCutoverAllowed, false);
  await assert.rejects(startRecoveryMediaBackup(id, { env: {}, fetcher }), /recovery_media_not_configured/);
  await assert.rejects(startRecoveryMediaBackup(id, { env: { ...env, SMARTSTORE_RECOVERY_MEDIA_ENABLED: '0' }, fetcher }), /recovery_media_disabled/);
  assert.equal(calls, 0);
});

test('server-only media transport signs the fixed request body and refuses redirects or non-recovery origins', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, `${origin}/v1/backups`);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
    const body = String(init?.body);
    assert.deepEqual(JSON.parse(body), { requestId: id, sources: ['listings', 'evidence', 'intake'] });
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Recovery-Timestamp'), String(now));
    const canonical = `${now}\nPOST\n/v1/backups\n${createHash('sha256').update(body).digest('hex')}`;
    assert.equal(headers.get('X-Recovery-Signature'), createHmac('sha256', secret).update(canonical).digest('hex'));
    return Response.json(run);
  };
  assert.equal((await startRecoveryMediaBackup(id, { env, fetcher, now })).id, id);
  assert.equal(signRecoveryMediaRequest(String(now), 'GET', '/v1/status', '', secret),
    createHmac('sha256', secret).update(`${now}\nGET\n/v1/status\n${createHash('sha256').update('').digest('hex')}`).digest('hex'));
  for (const badOrigin of ['http://127.0.0.1', 'https://evil.example', `${origin}/other`, `${origin}?key=secret`, 'https://user:pass@recovery.souqhamad.com']) {
    await assert.rejects(startRecoveryMediaBackup(id, { env: { ...env, SMARTSTORE_RECOVERY_MEDIA_ORIGIN: badOrigin }, fetcher }), /configuration_invalid/);
  }
  await assert.rejects(startRecoveryMediaBackup(id, { env, fetcher: async () =>
    new Response('', { status: 302, headers: { location: 'https://evil.example' } }) }), /recovery_media_unavailable/);
});

test('media status returns bounded aggregate values and never storage keys, URLs, contents or raw provider errors', async () => {
  const result = await getRecoveryMediaStatus({ env, now, fetcher: async () => Response.json({
    backupEnabled: true,
    runs: [{ ...run, secret: 'DO_NOT_RETURN', objects: 34, bytes: 3000 }],
    bucket: 'PRIVATE', objectKey: 'cases/private-evidence.json', password: secret,
  }) });
  assert.equal(result.readStatus, 'available'); assert.equal(result.runs[0].objects, 34);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN|PRIVATE|private-evidence|separate-recovery-worker-secret/);
  const invalid = await getRecoveryMediaStatus({ env, fetcher: async () => Response.json({ runs: Array.from({ length: 21 }, () => run) }) });
  assert.equal(invalid.readStatus, 'unavailable');
  await assert.rejects(getRecoveryMediaRun(id, 'backup', { env, fetcher: async () => new Response('{"password":SECRET123}', { status: 200 }) }), error => {
    assert.doesNotMatch(String(error), /SECRET123/); return true;
  });
});

test('the real Worker verifies server signatures and its disabled switch cannot enable backup controls', async () => {
  const { default: worker } = await import(pathToFileURL(resolve('cloudflare/recovery/worker.mjs')).href);
  const bucket = { async get() { return null; }, async list() { return { objects: [], truncated: false }; } };
  const workerEnv = { RECOVERY_WORKER_SECRET: secret, RECOVERY_MEDIA_ENABLED: '0', __now: () => now,
    VAULT: bucket, LISTINGS: bucket, EVIDENCE: bucket, INTAKE: bucket, JOBS: { async send() {} } };
  const fetcher: typeof fetch = async (url, init) => worker.fetch(new Request(String(url), init), workerEnv);
  const disabled = await getRecoveryMediaStatus({ env, fetcher, now });
  assert.equal(disabled.readStatus, 'available'); assert.equal(disabled.backupEnabled, false);
  workerEnv.RECOVERY_MEDIA_ENABLED = '1';
  assert.equal((await getRecoveryMediaStatus({ env, fetcher, now })).backupEnabled, true);
  assert.equal((await getRecoveryMediaStatus({ env: { ...env, SMARTSTORE_RECOVERY_MEDIA_SECRET: 'wrong-secret-'.repeat(4) }, fetcher, now })).readStatus, 'unavailable');
});

test('restoring media requires a separate confirmation and only sends a quarantined-restore job reference', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, `${origin}/v1/restores`);
    assert.deepEqual(JSON.parse(String(init?.body)), { requestId: id, backupRunId: backupId });
    return Response.json({ ...run, kind: 'quarantine_restore' });
  };
  await assert.rejects(restoreRecoveryMedia({ requestId: id, backupId, confirmation: 'restore' }, { env, fetcher }), /confirmation_invalid/);
  await assert.rejects(restoreRecoveryMedia({ requestId: '../escape', backupId, confirmation: recoveryMediaConfirmation }, { env, fetcher }), /confirmation_invalid/);
  assert.equal(calls, 0);
  const result = await restoreRecoveryMedia({ requestId: id, backupId, confirmation: recoveryMediaConfirmation }, { env, fetcher });
  assert.equal(result.kind, 'quarantine_restore'); assert.equal(calls, 1);
});
