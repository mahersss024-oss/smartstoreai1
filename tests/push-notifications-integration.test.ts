import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('service worker displays and routes push notifications', () => {
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

  assert.match(source, /smartstore-shell-v4/);
  assert.match(source, /addEventListener\('push'/);
  assert.match(source, /showNotification/);
  assert.match(source, /icon: '\/icon\.png'/);
  assert.match(source, /addEventListener\('notificationclick'/);
  assert.match(source, /clients\.openWindow/);
  assert.match(source, /payload\.url/);
});

test('service worker bypasses image requests so PWA media loads through the browser cache', () => {
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

  assert.match(source, /request\.destination === 'image'/);
  assert.doesNotMatch(source, /content-type'\)\?\.startsWith\('image\/'\)/);
});

test('service worker has a resilient offline navigation fallback', () => {
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

  assert.match(source, /const OFFLINE_HTML = `/);
  assert.match(source, /function offlineResponse\(\)/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /event\.preloadResponse/);
  assert.match(source, /navigationPreload\?\.enable/);
  assert.match(source, /cached \?\? offlineResponse\(\)/);
  assert.match(source, /cache\.put\(OFFLINE_URL, offlineResponse\(\)\)/);
});

test('service worker registration bypasses browser cache and checks for updates', () => {
  const source = readFileSync(
    join(process.cwd(), 'components', 'service-worker-registrar.tsx'),
    'utf8',
  );

  assert.match(source, /updateViaCache: 'none'/);
  assert.match(source, /registration\.update\(\)/);
  assert.doesNotMatch(source, /window\.addEventListener\('load'/);
});test('notifications page exposes push notifications as the opt-in setting', () => {
  const notificationsPage = readFileSync(join(process.cwd(), 'app', 'notifications', 'page.tsx'), 'utf8');
  const settings = readFileSync(join(process.cwd(), 'components', 'push-notification-settings.tsx'), 'utf8');
  assert.match(settings, /Notification\.requestPermission/);
  assert.match(settings, /pushManager\.subscribe/);
  assert.match(settings, /\/api\/push\/subscribe/);
  assert.match(settings, /variant\?: 'panel' \| 'icon'/);
  assert.match(settings, /const toggleNotifications = useCallback/);
  assert.match(notificationsPage, /CustomerAppGateway/);
});test('mobile navigation exposes notifications while the page keeps push settings', () => {
  const navigation = readFileSync(join(process.cwd(), 'components', 'mobile-bottom-navigation.tsx'), 'utf8');
  const notificationsPage = readFileSync(join(process.cwd(), 'app', 'notifications', 'page.tsx'), 'utf8');
  const settings = readFileSync(join(process.cwd(), 'components', 'push-notification-settings.tsx'), 'utf8');
  assert.match(navigation, /'\/notifications': Bell/);
  assert.match(notificationsPage, /CustomerAppGateway/);
  assert.match(settings, /const toggleNotifications = useCallback/);
  assert.match(settings, /const iconStatusRefreshDelayMs = 45_000/);
  assert.match(settings, /const iconUnreadRefreshDelayMs = 60_000/);
  assert.doesNotMatch(settings, /useSmartstoreRealtime/);
});

test('conversation messages trigger push notifications after successful send', () => {
  const route = readFileSync(
    join(
      process.cwd(),
      'app',
      'api',
      'marketplace',
      'conversations',
      '[conversationId]',
      'route.ts',
    ),
    'utf8',
  );

  const successIndex = route.indexOf("result.status === 'sent'");
  const notifyIndex = route.lastIndexOf('notifyConversationMessage');
  const responseIndex = route.lastIndexOf('Response.json(result');

  assert.ok(successIndex > -1, 'route should check for a sent message');
  assert.ok(notifyIndex > successIndex, 'notification should run after send success');
  assert.ok(responseIndex > notifyIndex, 'notification should complete before response');
  assert.match(route, /\.catch\(\(error\) =>/);
});

test('conversation push sender never targets the message sender', () => {
  const source = readFileSync(
    join(process.cwd(), 'lib', 'push', 'conversation-notifications.ts'),
    'utf8',
  );

  assert.match(source, /conversation\.buyerId === senderId/);
  assert.match(source, /return conversation\.sellerId/);
  assert.match(source, /conversation\.sellerId === senderId/);
  assert.match(source, /return conversation\.buyerId/);
  assert.match(source, /deactivateSubscriptionById/);
});

test('followed sellers notify followers only when listings become published', () => {
  const repository = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'repository.ts'),
    'utf8',
  );
  const adminRoute = readFileSync(
    join(process.cwd(), 'app', 'api', 'admin', 'listings', '[listingId]', 'route.ts'),
    'utf8',
  );
  const followNotifications = readFileSync(
    join(process.cwd(), 'lib', 'push', 'follow-notifications.ts'),
    'utf8',
  );

  assert.match(repository, /notifyFollowersWhenListingIsPublished/);
  assert.match(repository, /previousStatus === 'published'/);
  assert.match(repository, /listing\.status !== 'published'/);
  assert.match(repository, /type: 'follow_listing_published'/);
  assert.match(adminRoute, /existing\.status !== 'published' && updated\.status === 'published'/);
  assert.match(adminRoute, /notifyFollowersForAdminPublishedListing/);
  assert.match(followNotifications, /listActiveSubscriptionsForUser/);
  assert.match(followNotifications, /userId !== listing\.sellerId/);
  assert.match(followNotifications, /tag: `follow:listing:\$\{listing\.id\}`/);
  assert.doesNotMatch(followNotifications, /Conversation/);
});test('follow notifications are stored and exposed from the notifications page', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'prisma', 'migrations', '20260929100000_follow_notifications', 'migration.sql'), 'utf8');
  const repository = readFileSync(join(process.cwd(), 'agent', 'marketplace', 'repository.ts'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'notifications', 'route.ts'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'app', 'notifications', 'page.tsx'), 'utf8');
  assert.match(schema, /model FollowNotification/);
  assert.match(migration, /CREATE TABLE "FollowNotification"/);
  assert.match(repository, /createFollowNotificationsForListing/);
  assert.match(repository, /listAccountFollowNotifications/);
  assert.match(repository, /markAccountFollowNotificationsRead/);
  assert.match(route, /listAccountFollowNotifications/);
  assert.match(route, /markAccountFollowNotificationsRead/);
  assert.match(page, /CustomerAppGateway/);
});
