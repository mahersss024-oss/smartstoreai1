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
  assert.match(page, /اتفاقية رسوم المنصة/);
});

test('admin work surfaces stay dense and operational', () => {
  const dashboard = readProjectFile('app', 'admin', 'page.tsx');
  const usersPage = readProjectFile('app', 'admin', 'users', 'page.tsx');

  assert.match(dashboard, /data-testid="admin-work-queue"/);
  assert.match(dashboard, /moderatorWorkQueue/);
  assert.match(dashboard, /ownerWorkQueue/);
  assert.match(dashboard, /overview\.statuses\.reports\.open/);
  assert.match(dashboard, /overview\.statuses\.commissions\.due/);
  assert.match(dashboard, /px-3 py-2\.5 shadow-sm/);
  assert.match(dashboard, /sm:grid-cols-\[minmax\(0,12rem\)_minmax\(0,1fr\)\]/);
  assert.match(usersPage, /grid gap-2 rounded-md border bg-white px-3 py-2/);
  assert.match(usersPage, /border-b border-slate-200\/70 py-3 last:border-b-0/);
  assert.doesNotMatch(usersPage, /grid gap-4 rounded-md border bg-white p-4 shadow-sm/);
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

test('admin api permissions match the intended authority levels', () => {
  const adminOnlyRoutes = [
    ['app', 'api', 'admin', 'overview', 'route.ts'],
    ['app', 'api', 'admin', 'users', 'route.ts'],
    ['app', 'api', 'admin', 'users', '[userId]', 'route.ts'],
    ['app', 'api', 'admin', 'listings', '[listingId]', 'route.ts'],
  ];
  const moderatorRoutes = [
    ['app', 'api', 'admin', 'listings', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'listings', '[listingId]', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'reports', '[reportId]', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'user-reports', '[reportId]', 'route.ts'],
    ['app', 'api', 'moderator', 'overview', 'route.ts'],
  ];
  const ownerOnlyRoutes = [
    ['app', 'api', 'admin', 'commissions', 'route.ts'],
    ['app', 'api', 'admin', 'commissions', '[commissionId]', 'route.ts'],
    ['app', 'api', 'admin', 'maintenance', 'route.ts'],
  ];

  for (const routeSegments of adminOnlyRoutes) {
    const route = readProjectFile(...routeSegments);
    assert.match(route, /hasVerifiedAdminAccess/);
    assert.match(route, /(admin_required|auth_required)/);
  }

  for (const routeSegments of moderatorRoutes) {
    const route = readProjectFile(...routeSegments);
    assert.match(route, /hasVerifiedModeratorAccess/);
    assert.match(route, /(admin_required|auth_required)/);
  }

  for (const routeSegments of ownerOnlyRoutes) {
    const route = readProjectFile(...routeSegments);
    assert.match(route, /hasPlatformOwnerAccess/);
    assert.match(route, /owner_required/);
  }
});

test('customer mutation apis are scoped to the authenticated user', () => {
  const ownedMarketplaceRoutes = [
    ['app', 'api', 'account', 'profile', 'route.ts'],
    ['app', 'api', 'account', 'profile', 'picture', 'route.ts'],
    ['app', 'api', 'marketplace', 'commissions', '[commissionId]', 'route.ts'],
    ['app', 'api', 'marketplace', 'conversations', 'route.ts'],
    ['app', 'api', 'marketplace', 'conversations', '[conversationId]', 'route.ts'],
    ['app', 'api', 'marketplace', 'listings', 'route.ts'],
    ['app', 'api', 'marketplace', 'listings', '[listingId]', 'route.ts'],
    ['app', 'api', 'marketplace', 'listings', '[listingId]', 'favorite', 'route.ts'],
    ['app', 'api', 'marketplace', 'listings', '[listingId]', 'images', 'route.ts'],
    ['app', 'api', 'marketplace', 'listings', '[listingId]', 'images', '[imageId]', 'route.ts'],
    ['app', 'api', 'marketplace', 'listings', '[listingId]', 'reports', 'route.ts'],
    ['app', 'api', 'marketplace', 'users', '[userId]', 'follow', 'route.ts'],
    ['app', 'api', 'marketplace', 'users', '[userId]', 'ratings', 'route.ts'],
    ['app', 'api', 'marketplace', 'users', '[userId]', 'reports', 'route.ts'],
  ];

  for (const routeSegments of ownedMarketplaceRoutes) {
    const route = readProjectFile(...routeSegments);
    assert.match(route, /getAuthSession/);
    assert.match(route, /auth_required/);
    assert.match(route, /session\.user\.id/);
  }
});

test('cloud storage deletions stay behind owner or listing-owner checks', () => {
  const adminListingRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'listings',
    '[listingId]',
    'route.ts',
  );
  const maintenanceRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'maintenance',
    'route.ts',
  );
  const imageRoute = readProjectFile(
    'app',
    'api',
    'marketplace',
    'listings',
    '[listingId]',
    'images',
    '[imageId]',
    'route.ts',
  );

  assert.match(adminListingRoute, /hasVerifiedAdminAccess/);
  assert.match(adminListingRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(maintenanceRoute, /hasPlatformOwnerAccess/);
  assert.match(maintenanceRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(imageRoute, /getAuthSession/);
  assert.match(imageRoute, /session\.user\.id/);
  assert.match(imageRoute, /deleteListingImageForSeller/);
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
  assert.match(listingRoute, /include:\s*\{\s*images:\s*true,?\s*\}/);
  assert.match(listingRoute, /deleteStoredListingImagesBestEffort\(existing\.images\)/);
  assert.match(listingRoute, /admin_listing_storage_delete/);
});

test('moderators can view admin listings without listing mutation controls', () => {
  const listRoute = readProjectFile('app', 'api', 'admin', 'listings', 'route.ts');
  const page = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(listRoute, /hasVerifiedModeratorAccess/);
  assert.match(page, /useAdminAccess\('moderator'\)/);
  assert.match(page, /const canManageListings/);
  assert.match(page, /disabled=\{!canManageListings\}/);
  assert.match(page, /\{canManageListings && \(/);
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
  assert.match(maintenanceRoute, /closed_reports/);
  assert.match(maintenanceRoute, /closed_user_reports/);
  assert.match(maintenanceRoute, /seller_follows/);
  assert.match(maintenanceRoute, /seller_ratings/);
  assert.match(maintenanceRoute, /push_subscriptions/);
  assert.match(maintenanceRoute, /prisma\.userReport\.deleteMany/);
  assert.match(maintenanceRoute, /prisma\.sellerFollow\.deleteMany/);
  assert.match(maintenanceRoute, /prisma\.sellerRating\.deleteMany/);
  assert.match(maintenanceRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(maintenanceRoute, /admin_maintenance_listing_storage_delete/);
  assert.match(
    maintenanceRoute,
    /prisma\.listing\.deleteMany\(\{\s*where:\s*\{\s*status:\s*'deleted'\s*\}/,
  );
});

test('admin maintenance page offers the deleted-listings purge option', () => {
  const page = readProjectFile('app', 'admin', 'maintenance', 'page.tsx');

  assert.match(page, /purge_deleted_listings/);
  assert.match(page, /حذف نهائي للإعلانات المحذوفة من العملاء/);
  assert.match(page, /closed_user_reports/);
  assert.match(page, /seller_follows/);
  assert.match(page, /seller_ratings/);
  assert.match(page, /push_subscriptions/);
  assert.match(page, /countLabels/);
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

  assert.match(dashboard, /useAdminAccess\('moderator'\)/);
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

test('admin dashboard admits moderators and renders a scoped moderator view', () => {
  const dashboard = readProjectFile('app', 'admin', 'page.tsx');

  assert.match(dashboard, /useAdminAccess\('moderator'\)/);
  assert.match(dashboard, /isModeratorOnly/);
  assert.match(dashboard, /لوحة المشرف/);
  assert.match(dashboard, /\/api\/moderator\/overview/);
});

test('moderator overview api is server-side moderator protected and scoped', () => {
  const route = readProjectFile(
    'app',
    'api',
    'moderator',
    'overview',
    'route.ts',
  );

  assert.match(route, /hasVerifiedModeratorAccess/);
  assert.match(route, /openReports/);
  assert.match(route, /openUserReports/);
  // Must never expose owner/admin-only data such as commissions or users.
  assert.doesNotMatch(route, /commission/i);
  assert.doesNotMatch(route, /prisma\.user\b/);
});
