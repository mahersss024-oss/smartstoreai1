import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deactivateMobilePushToken,
  listActiveMobilePushTokensForUser,
  resetMobilePushTokenStoreForTests,
  saveMobilePushToken,
  saveMobilePushRegistration,
} from '@/agent/marketplace/mobile-push-tokens';
import { parseMobilePushRemovalToken } from '@/lib/push/mobile-registration';

test('saves a mobile push token and lists it for the user', async () => {
  resetMobilePushTokenStoreForTests();

  await saveMobilePushToken({
    userId: 'user-1',
    token: 'fcm-token-user-1',
    platform: 'android',
    appVersion: '1.0.5',
  });

  const active = await listActiveMobilePushTokensForUser('user-1');

  assert.equal(active.length, 1);
  assert.equal(active[0]?.token, 'fcm-token-user-1');
  assert.equal(active[0]?.platform, 'android');
});

test('upserts an existing mobile push token instead of duplicating', async () => {
  resetMobilePushTokenStoreForTests();

  await saveMobilePushToken({
    userId: 'user-1',
    token: 'shared-fcm-token',
    platform: 'android',
  });
  await saveMobilePushToken({
    userId: 'user-2',
    token: 'shared-fcm-token',
    platform: 'ios',
  });

  assert.equal((await listActiveMobilePushTokensForUser('user-1')).length, 0);

  const active = await listActiveMobilePushTokensForUser('user-2');

  assert.equal(active.length, 1);
  assert.equal(active[0]?.platform, 'ios');
});

test('deactivated mobile push tokens are not listed', async () => {
  resetMobilePushTokenStoreForTests();

  await saveMobilePushToken({
    userId: 'user-1',
    token: 'token-to-disable',
    platform: 'android',
  });
  await deactivateMobilePushToken('token-to-disable', 'user-1');

  const active = await listActiveMobilePushTokensForUser('user-1');

  assert.equal(active.length, 0);
});

test('private push delivery ends with its verified session even when the application never opens again', async () => {
  resetMobilePushTokenStoreForTests();
  await saveMobilePushToken({ userId: 'expired', token: 'expired-device-token', platform: 'android', sessionExpiresAt: new Date(Date.now() - 1) });
  assert.deepEqual(await listActiveMobilePushTokensForUser('expired'), []);
});

test('scoped removal cannot deactivate a newer registration or a different device', async () => {
  resetMobilePushTokenStoreForTests();
  const token = 'scoped-device-token-value';
  const first = await saveMobilePushRegistration({ userId: 'owner', token, platform: 'ios' });
  const old = parseMobilePushRemovalToken(first.removalToken, token)!;
  assert.ok(old);
  assert.equal(parseMobilePushRemovalToken(first.removalToken, 'different-token'), null);
  assert.equal(parseMobilePushRemovalToken(first.removalToken + 'x', token), null);
  const newer = await saveMobilePushRegistration({ userId: 'owner', token, platform: 'ios' });
  await deactivateMobilePushToken(token, old.userId, old.registrationKey);
  assert.equal((await listActiveMobilePushTokensForUser('owner')).length, 1);
  const current = parseMobilePushRemovalToken(newer.removalToken, token)!;
  await deactivateMobilePushToken(token, current.userId, current.registrationKey);
  assert.equal((await listActiveMobilePushTokensForUser('owner')).length, 0);
});
