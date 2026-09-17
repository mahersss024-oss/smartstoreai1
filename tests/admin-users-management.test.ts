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

test('admin pages verify access before protected admin api requests', () => {
  const pages = [
    ['app', 'admin', 'page.tsx'],
    ['app', 'admin', 'users', 'page.tsx'],
    ['app', 'admin', 'listings', 'page.tsx'],
    ['app', 'admin', 'commissions', 'page.tsx'],
    ['app', 'admin', 'moderation', 'page.tsx'],
    ['app', 'admin', 'maintenance', 'page.tsx'],
  ];

  for (const pageSegments of pages) {
    const page = readProjectFile(...pageSegments);
    const guardIndex = page.indexOf('verifyAdminAccess');
    const firstAdminApiIndex = page.indexOf('/api/admin/');

    assert.notEqual(
      guardIndex,
      -1,
      `${pageSegments.join('/')} must use the admin access guard`,
    );
    assert.notEqual(
      firstAdminApiIndex,
      -1,
      `${pageSegments.join('/')} must call an admin api`,
    );
    assert.ok(
      guardIndex < firstAdminApiIndex,
      `${pageSegments.join('/')} must verify access before calling admin api`,
    );
  }
});

test('admin realtime subscriptions wait for verified access', () => {
  const pages = [
    ['app', 'admin', 'page.tsx'],
    ['app', 'admin', 'listings', 'page.tsx'],
    ['app', 'admin', 'commissions', 'page.tsx'],
    ['app', 'admin', 'moderation', 'page.tsx'],
  ];

  for (const pageSegments of pages) {
    const page = readProjectFile(...pageSegments);

    assert.doesNotMatch(page, /enabled:\s*true/);
    assert.match(page, /enabled:\s*isAdminAccessAllowed/);
  }
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
  assert.match(listingRoute, /listing_must_be_deleted_first/);
});

test('account page shows the admin dashboard to the owner and appointed admins', () => {
  const page = readProjectFile('app', 'account', 'page.tsx');

  assert.match(page, /session\.user\?\.role === 'owner'/);
  assert.match(page, /session\.user\?\.role === 'admin'/);
  assert.match(page, /لوحة الإدارة/);
});

test('admin listings offer permanent deletion only for deleted listings', () => {
  const page = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(page, /listing\.status === 'deleted'/);
  assert.match(page, /حذف نهائي/);
  assert.match(page, /لا يمكن التراجع عن هذا الإجراء/);
  assert.match(page, /body: JSON\.stringify\(\{ status: 'deleted' \}\)/);
  assert.match(page, /method: 'DELETE'/);
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

test('admin maintenance exposes a scope that purges only soft-deleted listings', () => {
  const maintenanceRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'maintenance',
    'route.ts',
  );

  assert.match(maintenanceRoute, /purge_deleted_listings/);
  assert.match(
    maintenanceRoute,
    /prisma\.listing\.deleteMany\(\{\s*where:\s*\{\s*status:\s*'deleted'\s*\}/,
  );
});

test('admin maintenance page offers the deleted-listings purge option', () => {
  const page = readProjectFile('app', 'admin', 'maintenance', 'page.tsx');

  assert.match(page, /purge_deleted_listings/);
  assert.match(page, /حذف نهائي للإعلانات المحذوفة من العملاء/);
});

function withMaintenanceEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = new Map<string, string | undefined>();

  for (const key of Object.keys(overrides)) {
    previous.set(key, env[key]);

    if (overrides[key] === undefined) {
      delete env[key];
    } else {
      env[key] = overrides[key];
    }
  }

  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  });
}

function maintenanceCleanupRequest(email: string, role = 'admin') {
  return new Request('https://smartstore.test/api/admin/maintenance', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: createSessionCookie({
        id: `google:${email}`,
        email,
        role,
      }),
    },
    body: JSON.stringify({
      scope: 'marketplace_without_users',
      confirmation: 'confirm',
    }),
  });
}

test('destructive admin maintenance cleanup is disabled by default in production', async () => {
  await withMaintenanceEnv(
    {
      NODE_ENV: 'production',
      SMARTSTORE_MARKETPLACE_STORE: 'file',
      AUTH_SECRET: 'test-admin-maintenance-secret',
      SMARTSTORE_ADMIN_EMAILS: 'owner@example.com',
      SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: undefined,
    },
    async () => {
      const response = await runMaintenanceCleanup(
        maintenanceCleanupRequest('owner@example.com'),
      );
      assert.ok(response);
      const body = (await response.json()) as { error?: string };

      assert.equal(response.status, 403);
      assert.equal(body.error, 'maintenance_cleanup_disabled');
    },
  );
});

test('maintenance cleanup is restricted to the platform owner', async () => {
  await withMaintenanceEnv(
    {
      NODE_ENV: 'production',
      SMARTSTORE_MARKETPLACE_STORE: 'file',
      AUTH_SECRET: 'test-admin-maintenance-secret',
      SMARTSTORE_ADMIN_EMAILS: 'owner@example.com',
      SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: '1',
    },
    async () => {
      const response = await runMaintenanceCleanup(
        maintenanceCleanupRequest('appointed-admin@example.com'),
      );
      assert.ok(response);
      const body = (await response.json()) as { error?: string };

      assert.equal(response.status, 403);
      assert.equal(body.error, 'owner_required');
    },
  );
});

test('the owner account cannot be demoted or deleted by appointed admins', () => {
  const updateRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'users',
    '[userId]',
    'route.ts',
  );

  assert.match(updateRoute, /owner_account_protected/);
  assert.match(updateRoute, /owner_required/);
  assert.match(updateRoute, /cannot_delete_admin/);
  assert.match(updateRoute, /soft_deleted/);
  assert.match(updateRoute, /deletedAt/);
});

test('the users page hides role changes and protects the owner account', () => {
  const page = readProjectFile('app', 'admin', 'users', 'page.tsx');

  assert.match(page, /adminAccessRole === 'owner'/);
  assert.match(page, /canChangeRole/);
  assert.match(page, /isOwnerAccount/);
  assert.match(page, /حساب مالك المنصة محميّ/);
});

test('scoped admin roles are enforced consistently by pages and APIs', () => {
  const dashboard = readProjectFile('app', 'admin', 'page.tsx');
  const commissionsPage = readProjectFile(
    'app',
    'admin',
    'commissions',
    'page.tsx',
  );
  const commissionsRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'commissions',
    'route.ts',
  );
  const commissionRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'commissions',
    '[commissionId]',
    'route.ts',
  );
  const usersPage = readProjectFile('app', 'admin', 'users', 'page.tsx');
  const userRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'users',
    '[userId]',
    'route.ts',
  );

  assert.match(dashboard, /useAdminAccess\('admin'\)/);
  assert.match(dashboard, /const canManageCommissions = isOwner/);
  assert.match(commissionsPage, /useAdminAccess\('owner'\)/);
  assert.match(commissionsRoute, /hasPlatformOwnerAccess/);
  assert.match(commissionRoute, /hasPlatformOwnerAccess/);
  assert.match(usersPage, /\.\.\.\(isOwner \? \{ role: draft\.role \} : \{\}\)/);
  assert.match(userRoute, /!isOwner\s*&&\s*parsed\.data\.role/);
});

test('soft-deleted accounts remain visible to the owner and lose API access', () => {
  const usersPage = readProjectFile('app', 'admin', 'users', 'page.tsx');
  const proxy = readProjectFile('proxy.ts');
  const sessionRoute = readProjectFile(
    'app',
    'api',
    'auth',
    'session',
    'route.ts',
  );

  assert.match(usersPage, /includeDeleted/);
  assert.match(usersPage, /حساب معطّل/);
  assert.match(proxy, /select: \{ deletedAt: true \}/);
  assert.match(proxy, /clearSessionCookie/);
  assert.match(sessionRoute, /profile\.deletedAt/);
});
