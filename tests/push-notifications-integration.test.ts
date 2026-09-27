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

test('account page exposes push notifications as an opt-in setting', () => {
  const accountPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'page.tsx'),
    'utf8',
  );
  const settings = readFileSync(
    join(process.cwd(), 'components', 'push-notification-settings.tsx'),
    'utf8',
  );

  assert.match(accountPage, /PushNotificationSettings/);
  assert.match(settings, /Notification\.requestPermission/);
  assert.match(settings, /pushManager\.subscribe/);
  assert.match(settings, /\/api\/push\/subscribe/);
  assert.match(settings, /variant\?: 'panel' \| 'icon'/);
  assert.match(settings, /variant === 'icon'/);
  assert.match(settings, /isActive \? disableNotifications\(\) : enableNotifications\(\)/);
  assert.match(accountPage, /<PushNotificationSettings \/>/);
  assert.doesNotMatch(accountPage, /Notification\.requestPermission/);
});

test('home notification bell is shown only to signed-in users and toggles directly', () => {
  const homePage = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');

  assert.match(homePage, /session\.authenticated \? \(/);
  assert.match(homePage, /<PushNotificationSettings variant="icon" \/>/);
  assert.doesNotMatch(homePage, /href="\/account#notifications"/);
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
