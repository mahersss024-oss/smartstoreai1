import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('notifications can be deleted from the server and remain scoped to the account', () => {
  const route = readProjectFile('app', 'api', 'notifications', 'route.ts');
  const repository = readProjectFile('agent', 'marketplace', 'repository.ts');
  const notificationsPage = readProjectFile('app', 'notifications', 'page.tsx');
  const pushSettings = readProjectFile('components', 'push-notification-settings.tsx');

  assert.match(route, /export async function DELETE/);
  assert.match(route, /notifications_delete/);
  assert.match(route, /deleteAccountFollowNotification/);
  assert.match(route, /deleteAccountFollowNotifications/);
  assert.match(repository, /export async function deleteAccountFollowNotification/);
  assert.match(
    repository,
    /id: notificationId,[\s\S]*userId/,
  );
  assert.match(
    repository,
    /deleteMany\(\{[\s\S]*where: \{[\s\S]*userId/,
  );
  assert.match(notificationsPage, /method: 'DELETE'/);
  assert.match(notificationsPage, /encodeURIComponent\(notificationId\)/);
  assert.match(notificationsPage, /isDeleteAllConfirmOpen/);
  assert.match(notificationsPage, /deletingNotificationRef/);
  assert.match(notificationsPage, /isDeletingAllRef/);
  assert.match(notificationsPage, /notificationsChangedEventName/);
  assert.match(pushSettings, /notificationsChangedEventName/);
  assert.match(pushSettings, /refreshUnreadCount/);
});
