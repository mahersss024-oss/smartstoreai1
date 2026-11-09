import assert from 'node:assert/strict';
import test from 'node:test';
import { POST, DELETE } from '@/app/api/mobile/push/register/route';
import { createSignedSession, parseSignedSession } from '@/lib/auth/session';
import { listActiveMobilePushTokensForUser, resetMobilePushTokenStoreForTests } from '@/agent/marketplace/mobile-push-tokens';

test('device-only removal works without a login and never grants registration or removes a newer owner', async t => {
  for (const [key, value] of Object.entries({ SMARTSTORE_MARKETPLACE_STORE: 'file', AUTH_SECRET: 'push-removal-route-isolated-secret', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  resetMobilePushTokenStoreForTests();
  const token = 'fixture-device-native-token-long';
  const request = (method: string, body: unknown, bearer?: string) => new Request('https://test.invalid/api/mobile/push/register', {
    method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body),
  });
  const a = createSignedSession({ id: 'push-a', email: 'a@example.test' });
  const first = await POST(request('POST', { token, platform: 'ios', sessionExpiresAt: '2099-01-01' }, a));
  assert.equal(first.status, 200);
  const removal = (await first.json()).removalToken;
  assert.equal((await POST(request('POST', { token, platform: 'ios', removalToken: removal }))).status, 401);
  assert.equal((await DELETE(request('DELETE', { token, removalToken: removal + 'tampered' }))).status, 401);
  const b = createSignedSession({ id: 'push-b', email: 'b@example.test' });
  const second = await POST(request('POST', { token, platform: 'ios' }, b));
  const current = (await second.json()).removalToken;
  assert.equal((await DELETE(request('DELETE', { token, removalToken: removal }))).status, 200);
  assert.equal((await listActiveMobilePushTokensForUser('push-b')).length, 1);
  assert.equal((await DELETE(request('DELETE', { token, removalToken: current }))).status, 200);
  assert.equal((await listActiveMobilePushTokensForUser('push-b')).length, 0);
  assert.ok(parseSignedSession(a)?.expiresAt);
});
