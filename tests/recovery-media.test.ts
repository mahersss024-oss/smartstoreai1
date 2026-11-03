import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { getRecoveryMediaStatus } from '@/lib/recovery/media';

const secret = 'test-only-separate-read-only-status-secret';
const origin = 'https://recovery-status.souqhamad.com';
const now = Date.parse('2026-11-03T12:00:00Z');
const env = { SMARTSTORE_RECOVERY_MEDIA_MONITORING_ENABLED: '1', SMARTSTORE_RECOVERY_MEDIA_MONITORING_ORIGIN: origin,
  SMARTSTORE_RECOVERY_MEDIA_MONITORING_SECRET: secret };
const run = { runId: '218321e6-ed8a-4434-a07a-e8fe1f12554b', kind: 'backup', status: 'completed',
  createdAt: new Date(now).toISOString(), objects: 4000, bytes: 30000, errors: 0 };

test('old control flags and control credentials cannot authorize media monitoring requests', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('Must never call a provider.'); };
  const result = await getRecoveryMediaStatus({ env: { SMARTSTORE_RECOVERY_MEDIA_ENABLED: '1',
    SMARTSTORE_RECOVERY_MEDIA_ORIGIN: 'https://recovery.souqhamad.com', SMARTSTORE_RECOVERY_MEDIA_SECRET: secret }, fetcher });
  assert.equal(result.readStatus, 'not_configured'); assert.equal(result.backupEnabled, false); assert.equal(calls, 0);
});
test('status transport is GET-only and refuses executable capabilities or private fields from the upstream', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, `${origin}/v1/status`); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
    const headers = new Headers(init?.headers);
    const canonical = `${now}\nGET\n/v1/status\n${createHash('sha256').update('').digest('hex')}`;
    assert.equal(headers.get('X-Recovery-Signature'), createHmac('sha256', secret).update(canonical).digest('hex'));
    return Response.json({ backupEnabled: true, runs: [{ ...run, objectKey: 'PRIVATE', secret }], endpoint: 'PRIVATE' });
  };
  const result = await getRecoveryMediaStatus({ env, fetcher, now });
  assert.equal(result.readStatus, 'available'); assert.equal(result.monitoringOnly, true); assert.equal(result.backupEnabled, false);
  assert.equal(result.productionCutoverAllowed, false); assert.equal(result.runs[0].objects, 4000);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|test-only-separate/);
});
test('control endpoints, arbitrary origins, redirects and oversized provider responses fail closed', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return Response.json({ runs: [] }); };
  for (const bad of ['https://recovery.souqhamad.com', 'https://evil.example', `${origin}/restore`, `${origin}?token=secret`]) {
    assert.equal((await getRecoveryMediaStatus({ env: { ...env, SMARTSTORE_RECOVERY_MEDIA_MONITORING_ORIGIN: bad }, fetcher })).readStatus, 'unavailable');
  }
  assert.equal(calls, 0);
  assert.equal((await getRecoveryMediaStatus({ env, fetcher: async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }) })).readStatus, 'unavailable');
  assert.equal((await getRecoveryMediaStatus({ env, fetcher: async () => new Response('a'.repeat(65537)) })).readStatus, 'unavailable');
});
