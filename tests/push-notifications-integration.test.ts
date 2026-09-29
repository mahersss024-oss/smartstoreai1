import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('service worker displays and routes push notifications', () => {
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

  assert.match(source, /addEventListener\('push'/);
  assert.match(source, /showNotification/);
  assert.match(source, /icon: '\/icon\.png'/);
  assert.match(source, /addEventListener\('notificationclick'/);
  assert.match(source, /clients\.openWindow/);
  assert.match(source, /payload\.url/);
});

test('notifications page exposes push notifications as the opt-in setting', () => {
  const accountPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'page.tsx'),
    'utf8',
  );
  const notificationsPage = readFileSync(
    join(process.cwd(), 'app', 'notifications', 'page.tsx'),
    'utf8',
  );
  const settings = readFileSync(
    join(process.cwd(), 'components', 'push-notification-settings.tsx'),
    'utf8',
  );

  assert.doesNotMatch(accountPage, /PushNotificationSettings/);
  assert.match(accountPage, /href="\/notifications"/);
  assert.match(settings, /Notification\.requestPermission/);
  assert.match(settings, /pushManager\.subscribe/);
  assert.match(settings, /\/api\/push\/subscribe/);
  assert.match(settings, /variant\?: 'panel' \| 'icon'/);
  assert.match(settings, /variant === 'icon'/);
  assert.match(settings, /isActive \? disableNotifications\(\) : enableNotifications\(\)/);
  assert.match(notificationsPage, /<PushNotificationSettings \/>/);
  assert.doesNotMatch(accountPage, /Notification\.requestPermission/);
});

test('home notification bell is shown only to signed-in users and opens notifications page', () => {
  const homePage = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');
  const settings = readFileSync(
    join(process.cwd(), 'components', 'push-notification-settings.tsx'),
    'utf8',
  );

  assert.match(homePage, /session\.authenticated \? \(/);
  assert.match(homePage, /<PushNotificationSettings variant="icon" \/>/);
  assert.match(settings, /import Link from 'next\/link'/);
  assert.match(settings, /href="\/notifications"/);
  assert.match(settings, /unreadCount > 0/);
  assert.match(settings, /follow_listing_published/);
  assert.doesNotMatch(settings, /className="hidden sm:inline-flex"/);
  assert.match(settings, /className="shrink-0"/);
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
});

test('follow notifications are stored and exposed from the notifications page', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260929100000_follow_notifications',
      'migration.sql',
    ),
    'utf8',
  );
  const repository = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'repository.ts'),
    'utf8',
  );
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'notifications', 'route.ts'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'app', 'notifications', 'page.tsx'), 'utf8');
  const accountPage = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(schema, /model FollowNotification/);
  assert.match(migration, /CREATE TABLE "FollowNotification"/);
  assert.match(repository, /createFollowNotificationsForListing/);
  assert.match(repository, /listAccountFollowNotifications/);
  assert.match(repository, /markAccountFollowNotificationsRead/);
  assert.match(route, /listAccountFollowNotifications/);
  assert.match(route, /markAccountFollowNotificationsRead/);
  assert.match(page, /fetch\('\/api\/notifications'/);
  assert.match(page, /<PushNotificationSettings \/>/);
  assert.match(page, /markAllRead/);
  assert.match(page, /follow_listing_published/);
  assert.match(accountPage, /href="\/notifications"/);
});
