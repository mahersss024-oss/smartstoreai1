import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  deactivatePushSubscription,
  listActiveSubscriptionsForUser,
  resetPushSubscriptionStoreForTests,
  savePushSubscription,
} from '@/agent/marketplace/push-subscriptions';

afterEach(() => {
  resetPushSubscriptionStoreForTests();
});

test('saves a subscription and lists it for the user', async () => {
  const id = await savePushSubscription({
    userId: 'user-1',
    endpoint: 'https://push.example.com/abc',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    locale: 'ar',
  });

  assert.ok(id);

  const active = await listActiveSubscriptionsForUser('user-1');

  assert.equal(active.length, 1);
  assert.equal(active[0]?.endpoint, 'https://push.example.com/abc');
});

test('upserts on the same endpoint instead of duplicating', async () => {
  await savePushSubscription({
    userId: 'user-2',
    endpoint: 'https://push.example.com/dup',
    p256dh: 'first',
    auth: 'first',
  });
  await savePushSubscription({
    userId: 'user-2',
    endpoint: 'https://push.example.com/dup',
    p256dh: 'second',
    auth: 'second',
  });

  const active = await listActiveSubscriptionsForUser('user-2');

  assert.equal(active.length, 1);
  assert.equal(active[0]?.p256dh, 'second');
});

test('deactivated subscriptions are not listed', async () => {
  const endpoint = 'https://push.example.com/deactivate';

  await savePushSubscription({
    userId: 'user-3',
    endpoint,
    p256dh: 'key',
    auth: 'auth',
  });
  await deactivatePushSubscription(endpoint);

  const active = await listActiveSubscriptionsForUser('user-3');

  assert.equal(active.length, 0);
});

test('subscriptions are scoped per user', async () => {
  await savePushSubscription({
    userId: 'user-a',
    endpoint: 'https://push.example.com/a',
    p256dh: 'a',
    auth: 'a',
  });
  await savePushSubscription({
    userId: 'user-b',
    endpoint: 'https://push.example.com/b',
    p256dh: 'b',
    auth: 'b',
  });

  const activeA = await listActiveSubscriptionsForUser('user-a');

  assert.equal(activeA.length, 1);
  assert.equal(activeA[0]?.endpoint, 'https://push.example.com/a');
});
