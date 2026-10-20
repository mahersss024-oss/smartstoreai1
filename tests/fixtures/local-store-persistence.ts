import assert from 'node:assert/strict';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function assertContained(directory: string, parent: string) {
  const child = relative(parent, directory);
  assert.ok(child && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

async function main() {
  // Validate the isolated child boundary before importing any persistence module.
  assert.equal(process.env.SMARTSTORE_LOCAL_PERSISTENCE_FIXTURE, '1');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'file');
  assert.equal(process.env.DATABASE_URL, '');
  assert.notEqual(process.env.npm_lifecycle_event, 'test');
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
  const fixtureRoot = resolve(process.env.SMARTSTORE_LOCAL_PERSISTENCE_ROOT ?? '');
  assertContained(fixtureRoot, join(repositoryRoot, '.data/project-repair'));
  assertContained(process.cwd(), fixtureRoot);
  const configured = process.env.SMARTSTORE_DATA_DIR?.trim();
  assertContained(configured ? resolve(configured) : join(process.cwd(), '.data'), fixtureRoot);

  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests++;
    throw new Error('Network access is forbidden in the local persistence fixture.');
  };
  const [marketplace, webPush, mobilePush] = await Promise.all([
    import('../../agent/marketplace/store'),
    import('../../agent/marketplace/push-subscriptions'),
    import('../../agent/marketplace/mobile-push-tokens'),
  ]);
  const userId = 'local-persistence-synthetic-user';
  const listingId = 'local-persistence-synthetic-listing';
  const endpoint = 'https://push.example.invalid/local-persistence';
  const token = 'local-persistence-synthetic-mobile-token';
  const action = process.argv[2];
  assert.ok(action === 'write' || action === 'read');
  if (action === 'write') {
    marketplace.createListingDraft({ id: listingId, sellerId: userId,
      category: 'mobile_phones', title: 'هاتف لاختبار التخزين المحلي' });
    await webPush.savePushSubscription({ userId, endpoint, p256dh: 'synthetic-p256dh', auth: 'synthetic-auth' });
    await mobilePush.saveMobilePushToken({ userId, token, platform: 'android' });
  }
  const listing = marketplace.getListing(listingId);
  const subscriptions = await webPush.listActiveSubscriptionsForUser(userId);
  const tokens = await mobilePush.listActiveMobilePushTokensForUser(userId);
  assert.equal(listing?.sellerId, userId);
  assert.equal(listing?.title, 'هاتف لاختبار التخزين المحلي');
  assert.equal(listing?.status, 'draft');
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].endpoint, endpoint);
  assert.equal(subscriptions[0].p256dh, 'synthetic-p256dh');
  assert.equal(subscriptions[0].auth, 'synthetic-auth');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token, token);
  assert.equal(tokens[0].platform, 'android');
  assert.equal(networkRequests, 0);
  console.log(JSON.stringify({ pid: process.pid, listingId,
    pushId: subscriptions[0].id, mobileId: tokens[0].id }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Local persistence fixture failed.');
  process.exitCode = 1;
});
