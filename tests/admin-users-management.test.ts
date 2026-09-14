import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { POST as runMaintenanceCleanup } from '@/app/api/admin/maintenance/route';
import { createSessionCookie } from '@/lib/auth/session';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('admin dashboard links to user management', () => {
  const page = readProjectFile('app', 'admin', 'page.tsx');

  assert.match(page, /\/admin\/users/);
  assert.match(page, /إدارة المستخدمين/);
});

test('admin users page exposes searchable account control', () => {
  const page = readProjectFile('app', 'admin', 'users', 'page.tsx');

  assert.match(page, /\/api\/admin\/users/);
  assert.match(page, /roleFilter/);
  assert.match(page, /phoneNumber/);
  assert.match(page, /userReportsReceived/);
  assert.match(page, /حذف المستخدم/);
  assert.match(page, /method: 'DELETE'/);
  assert.match(page, /حفظ التعديلات/);
  assert.match(page, /اتفاقية العمولة/);
});

test('admin users api is server-side admin protected and audited', () => {
  const listRoute = readProjectFile('app', 'api', 'admin', 'users', 'route.ts');
  const updateRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'users',
    '[userId]',
    'route.ts',
  );

  assert.match(listRoute, /hasVerifiedAdminAccess/);
  assert.match(listRoute, /userReportsReceived/);
  assert.match(updateRoute, /hasVerifiedAdminAccess/);
  assert.match(updateRoute, /enforceApiRateLimit/);
  assert.match(updateRoute, /admin_user_mutation/);
  assert.match(updateRoute, /cannot_downgrade_self/);
  assert.match(updateRoute, /cannot_delete_self/);
  assert.match(updateRoute, /normalizeContactPhoneNumber/);
  assert.match(updateRoute, /update_user/);
  assert.match(updateRoute, /delete_user/);
  assert.match(updateRoute, /adminAuditLog\.create/);
});

test('admin listing mutations are server-side protected and rate limited', () => {
  const listingRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'listings',
    '[listingId]',
    'route.ts',
  );

  assert.match(listingRoute, /hasVerifiedAdminAccess/);
  assert.match(listingRoute, /enforceApiRateLimit/);
  assert.match(listingRoute, /admin_listing_mutation/);
  assert.match(listingRoute, /adminAuditLog\.create/);
});

test('admin commission, moderation, and maintenance mutations are rate limited', () => {
  const commissionRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'commissions',
    '[commissionId]',
    'route.ts',
  );
  const listingModerationRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'moderation',
    'listings',
    '[listingId]',
    'route.ts',
  );
  const reportModerationRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'moderation',
    'reports',
    '[reportId]',
    'route.ts',
  );
  const maintenanceRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'maintenance',
    'route.ts',
  );

  assert.match(commissionRoute, /admin_commission_mutation/);
  assert.match(listingModerationRoute, /moderation_mutation/);
  assert.match(reportModerationRoute, /moderation_report_mutation/);
  assert.match(maintenanceRoute, /admin_maintenance_cleanup/);
});

test('destructive admin maintenance cleanup is disabled by default in production', async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousStore = env.SMARTSTORE_MARKETPLACE_STORE;
  const previousCleanupFlag = env.SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP;
  const previousAuthSecret = env.AUTH_SECRET;
  env.NODE_ENV = 'production';
  env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  env.AUTH_SECRET = 'test-admin-maintenance-secret';
  delete env.SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP;

  try {
    const response = await runMaintenanceCleanup(
      new Request('https://smartstore.test/api/admin/maintenance', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: createSessionCookie({
            id: 'google:maintenance-admin',
            email: 'maintenance-admin@example.com',
            role: 'admin',
          }),
        },
        body: JSON.stringify({
          scope: 'marketplace_without_users',
          confirmation: 'confirm',
        }),
      }),
    );
    assert.ok(response);
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 403);
    assert.equal(body.error, 'maintenance_cleanup_disabled');
  } finally {
    if (previousNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = previousNodeEnv;
    }

    if (previousStore === undefined) {
      delete env.SMARTSTORE_MARKETPLACE_STORE;
    } else {
      env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    }

    if (previousCleanupFlag === undefined) {
      delete env.SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP;
    } else {
      env.SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP = previousCleanupFlag;
    }

    if (previousAuthSecret === undefined) {
      delete env.AUTH_SECRET;
    } else {
      env.AUTH_SECRET = previousAuthSecret;
    }
  }
});
