import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deactivateMobilePushToken,
  listActiveMobilePushTokensForUser,
  resetMobilePushTokenStoreForTests,
  saveMobilePushToken,
} from '@/agent/marketplace/mobile-push-tokens';

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
