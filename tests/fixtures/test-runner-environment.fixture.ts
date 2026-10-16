import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listActiveMobilePushTokensForUser,
  resetMobilePushTokenStoreForTests,
  saveMobilePushToken,
} from '@/agent/marketplace/mobile-push-tokens';

test('the test launcher normalizes lifecycle and keeps reset stores free of old disk records', async () => {
  assert.equal(process.env.npm_lifecycle_event, 'test');
  assert.equal(process.env.SMARTSTORE_DB_INTEGRATION, process.env.RUNNER_EXPECT_DATABASE_INTEGRATION);
  assert.ok(process.env.SMARTSTORE_DATA_DIR);
  assert.notEqual(process.env.SMARTSTORE_DATA_DIR, process.env.RUNNER_PARENT_DATA_DIR);
  resetMobilePushTokenStoreForTests();
  await saveMobilePushToken({ userId: 'launcher-fixture', token: 'launcher-fixture-token', platform: 'android' });
  assert.equal((await listActiveMobilePushTokensForUser('launcher-fixture')).length, 1);
  resetMobilePushTokenStoreForTests();
  assert.equal((await listActiveMobilePushTokensForUser('launcher-fixture')).length, 0);
});
