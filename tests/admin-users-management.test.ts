import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { POST as runMaintenanceCleanup } from '@/app/api/admin/maintenance/route';
import { createSessionCookie } from '@/lib/auth/session';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('admin pages use a stable touch viewport without disabling page scrolling', () => {
  const layout = readProjectFile('app', 'admin', 'layout.tsx');
  const globalCss = readProjectFile('app', 'globals.css');

  assert.match(layout, /className="admin-viewport"/);
  assert.match(
    globalCss,
    /\.admin-viewport\s*\{[^}]*touch-action:\s*pan-x pan-y;/,
  );
  assert.match(
    globalCss,
    /main\[class\*="bg-\[#e8edf3\]"\][^{]*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*hidden;/,
  );
  assert.match(
    globalCss,
    /\.admin-viewport header,[\s\S]*\.admin-viewport form[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;/,
  );
  assert.match(
    globalCss,
    /\.admin-viewport \[dir="ltr"\][\s\S]*overflow-wrap:\s*anywhere;/,
  );
  assert.match(
    globalCss,
    /\.admin-viewport > main,[\s\S]*padding-top:\s*var\(--safe-area-top\);/,
  );
  assert.match(
    globalCss,
    /\.admin-viewport > main > div > header:first-child,[\s\S]*top:\s*var\(--safe-area-top\);/,
  );
  assert.doesNotMatch(
    globalCss,
    /\.admin-viewport\s*\{[^}]*touch-action:\s*none;/,
  );
});

test('app pages use in-app confirmations instead of browser dialogs', () => {
  const pages = [
    ['app', 'account', 'page.tsx'],
    ['app', 'account', 'listings', 'page.tsx'],
    ['app', 'conversations', 'page.tsx'],
    ['app', 'conversations', '[conversationId]', 'page.tsx'],
    ['app', 'admin', 'users', 'page.tsx'],
    ['app', 'admin', 'listings', 'page.tsx'],
    ['app', 'admin', 'commissions', 'page.tsx'],
    ['app', 'admin', 'moderation', 'page.tsx'],
  ];

  for (const pageSegments of pages) {
    const page = readProjectFile(...pageSegments);

    assert.doesNotMatch(page, /window\.confirm/);
    assert.doesNotMatch(page, /window\.alert/);
  }
});

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
  assert.match(page, /appliedQuery/);
  assert.match(page, /setAppliedQuery\(nextQuery\)/);
});

test('admin access revalidation keeps the verified role stable while loading', () => {
  const accessHook = readProjectFile('app', 'admin', 'use-admin-access.ts');
  const verificationStart = accessHook.indexOf(
    'const verifyAdminAccess = useCallback',
  );
  const requestStart = accessHook.indexOf("fetch('/api/auth/session'", verificationStart);
  const beforeRequest = accessHook.slice(verificationStart, requestStart);

  assert.doesNotMatch(beforeRequest, /setRole\(null\)/);
  assert.match(accessHook, /if \(!response\.ok\) \{\s*setRole\(null\)/);
});

test('admin dashboard stays focused on required statistics and administrative navigation', () => {
  const dashboard = readProjectFile('app', 'admin', 'page.tsx');
  const usersPage = readProjectFile('app', 'admin', 'users', 'page.tsx');
  const moderationPage = readProjectFile('app', 'admin', 'moderation', 'page.tsx');
  const listingsPage = readProjectFile('app', 'admin', 'listings', 'page.tsx');
  const commissionsPage = readProjectFile('app', 'admin', 'commissions', 'page.tsx');

  assert.match(dashboard, /aria-label="أقسام الإدارة"/);
  assert.match(dashboard, /المراجعة والبلاغات/);
  assert.match(dashboard, /الصيانة والتنظيف/);
  assert.doesNotMatch(dashboard, /admin-work-queue/);
  assert.doesNotMatch(dashboard, /StatCard/);
  assert.doesNotMatch(dashboard, /StatusBlock/);
  assert.match(dashboard, /\/api\/admin\/overview/);
  assert.match(dashboard, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(usersPage, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(moderationPage, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(listingsPage, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(commissionsPage, /\/hamad-market-logo\.webp/);
  assert.match(dashboard, /إجمالي المستخدمين/);
  assert.match(dashboard, /المستخدمون النشطون/);
  assert.match(dashboard, /الإعلانات المنشورة/);
  assert.match(dashboard, /البلاغات المفتوحة/);
  assert.match(dashboard, /سجل الإدارة/);
  assert.match(usersPage, /grid max-w-full gap-2 overflow-hidden rounded-md border bg-white px-3 py-2/);
  assert.match(usersPage, /border-b border-slate-200\/70 py-3 last:border-b-0/);
  assert.doesNotMatch(usersPage, /grid gap-4 rounded-md border bg-white p-4 shadow-sm/);
});

test('admin users page keeps long account identifiers inside android pwa viewport', () => {
  const page = readProjectFile('app', 'admin', 'users', 'page.tsx');

  assert.match(page, /<main className="[^"]*overflow-x-hidden/);
  assert.match(page, /<header className="[^"]*max-w-full[^"]*overflow-hidden/);
  assert.match(page, /className="[^"]*min-w-0 flex-1 items-center gap-3/);
  assert.match(page, /className="mt-1 break-all text-\[11px\] leading-4 text-muted-foreground"/);
  assert.match(page, /className="h-11 min-w-0 rounded-md border bg-background/);
});

test('admin pages verify access before protected admin api requests', () => {
  const pages = [
    ['app', 'admin', 'page.tsx'],
    ['app', 'admin', 'users', 'page.tsx'],
    ['app', 'admin', 'listings', 'page.tsx'],
    ['app', 'admin', 'commissions', 'page.tsx'],
    ['app', 'admin', 'moderation', 'page.tsx'],
    ['app', 'admin', 'maintenance', 'page.tsx'],
    ['app', 'admin', 'audit-log', 'page.tsx'],
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
    if (firstAdminApiIndex !== -1) {
      assert.ok(
        guardIndex < firstAdminApiIndex,
        `${pageSegments.join('/')} must verify access before calling admin api`,
      );
    }
  }
});

test('admin api permissions match the intended authority levels', () => {
  const adminOnlyRoutes = [
    ['app', 'api', 'admin', 'overview', 'route.ts'],
    ['app', 'api', 'admin', 'users', 'route.ts'],
    ['app', 'api', 'admin', 'users', '[userId]', 'route.ts'],
    ['app', 'api', 'admin', 'audit-log', 'route.ts'],
    ['app', 'api', 'admin', 'commissions', 'route.ts'],
    ['app', 'api', 'admin', 'commissions', '[commissionId]', 'route.ts'],
    ['app', 'api', 'admin', 'maintenance', 'route.ts'],
    ['app', 'api', 'admin', 'site-message', 'route.ts'],
  ];
  const moderatorRoutes = [
    ['app', 'api', 'admin', 'listings', 'route.ts'],
    ['app', 'api', 'admin', 'listings', '[listingId]', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'listings', '[listingId]', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'reports', '[reportId]', 'route.ts'],
    ['app', 'api', 'admin', 'moderation', 'user-reports', '[reportId]', 'route.ts'],
    ['app', 'api', 'moderator', 'overview', 'route.ts'],
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

test('cloud storage deletions stay behind moderator/admin or listing-owner checks', () => {
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

  assert.match(adminListingRoute, /hasVerifiedModeratorAccess/);
  assert.match(adminListingRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(maintenanceRoute, /hasVerifiedAdminAccess/);
  assert.match(maintenanceRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(imageRoute, /getAuthSession/);
  assert.match(imageRoute, /session\.user\.id/);
  assert.match(imageRoute, /deleteListingImageForSeller/);
});

test('admin realtime subscriptions wait for verified access', () => {
  const pages = [
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
  assert.match(updateRoute, /requestedMode === 'permanent' && !hasOwnerLevelAdminAccess/);
  assert.match(updateRoute, /account_must_be_disabled_first/);
  assert.match(updateRoute, /deleteUserImagesBestEffort/);
  assert.match(updateRoute, /deleteListingObject/);
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

  assert.match(listingRoute, /hasVerifiedModeratorAccess/);
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

test('admin listings return every listing image instead of a partial preview', () => {
  const route = readProjectFile('app', 'api', 'admin', 'listings', 'route.ts');
  const page = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(route, /images:\s*\{[\s\S]*orderBy: \[\{ isPrimary: 'desc' \}, \{ createdAt: 'asc' \}\]/);
  assert.doesNotMatch(route, /images:\s*\{[\s\S]{0,160}take: 3/);
  assert.match(page, /listing\.images\.map\(\(image\) =>/);
  assert.match(page, /overflow-x-auto/);
});

test('admin listings search supports listing id lookup', () => {
  const route = readProjectFile('app', 'api', 'admin', 'listings', 'route.ts');
  const page = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(route, /id:\s*\{\s*contains:\s*query,\s*mode:\s*'insensitive' as const\s*\}/);
  assert.match(page, /placeholder="[^"]*رقم الإعلان/);
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

test('closed moderation reports can be deleted only through moderator-protected routes', () => {
  const listingReportRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'moderation',
    'reports',
    '[reportId]',
    'route.ts',
  );
  const conversationReportRoute = readProjectFile(
    'app',
    'api',
    'admin',
    'moderation',
    'user-reports',
    '[reportId]',
    'route.ts',
  );

  for (const route of [listingReportRoute, conversationReportRoute]) {
    assert.match(route, /export async function DELETE/);
    assert.match(route, /hasVerifiedModeratorAccess/);
    assert.match(route, /report\.status === 'open'/);
    assert.match(route, /report_must_be_closed/);
    assert.match(route, /adminAuditLog\.create/);
  }

  assert.match(listingReportRoute, /prisma\.report\.delete/);
  assert.match(conversationReportRoute, /prisma\.userReport\.delete/);
});

test('conversation reports stay compact until an administrator opens details', () => {
  const page = readProjectFile('app', 'admin', 'moderation', 'page.tsx');

  assert.match(page, /expandedReportId/);
  assert.match(page, /isExpanded &&/);
  assert.match(page, /عرض التفاصيل/);
  assert.match(page, /إخفاء التفاصيل/);
  assert.match(page, /messagePreview/);
  assert.match(page, /canDeleteReports && report\.status !== 'open'/);
  assert.match(page, /method: 'DELETE'/);
});

test('admin maintenance keeps routine cleanup away from customer and financial data', () => {
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
  assert.match(maintenanceRoute, /search_state/);
  assert.match(maintenanceRoute, /searchStateCleanupMaxAgeMs/);
  assert.doesNotMatch(maintenanceRoute, /database\.apiIdempotencyKey\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.commission\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.conversation\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.userBlock\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.sellerFollow\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.sellerRating\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.pushSubscription\.deleteMany/);
  assert.doesNotMatch(maintenanceRoute, /prisma\.siteVisitDaily\.deleteMany/);
  assert.doesNotMatch(
    maintenanceRoute,
    /prisma\.listing\.deleteMany\(\s*\)/,
  );
  assert.match(maintenanceRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(maintenanceRoute, /admin_maintenance_listing_storage_delete/);
  assert.match(
    maintenanceRoute,
    /database\.listing\.deleteMany\(\{\s*where:\s*\{\s*status:\s*'deleted'\s*\}/,
  );
  assert.match(maintenanceRoute, /prisma\.\$transaction\(async \(tx\)/);
});

test('admin maintenance page offers the deleted-listings purge option', () => {
  const page = readProjectFile('app', 'admin', 'maintenance', 'page.tsx');

  assert.match(page, /purge_deleted_listings/);
  assert.match(page, /حذف نهائي للإعلانات المحذوفة من العملاء/);
  assert.match(page, /closed_user_reports/);
  assert.doesNotMatch(page, /value: 'commissions'/);
  assert.doesNotMatch(page, /value: 'conversations'/);
  assert.doesNotMatch(page, /value: 'reports'/);
  assert.doesNotMatch(page, /value: 'user_reports'/);
  assert.doesNotMatch(page, /value: 'user_blocks'/);
  assert.doesNotMatch(page, /value: 'seller_follows'/);
  assert.doesNotMatch(page, /value: 'seller_ratings'/);
  assert.doesNotMatch(page, /value: 'push_subscriptions'/);
  assert.doesNotMatch(page, /value: 'analytics'/);
  assert.doesNotMatch(page, /marketplace_without_users/);
  assert.match(page, /getCleanupPreview/);
  assert.match(page, /deletedListings/);
  assert.match(page, /deletedListingImages/);
  assert.match(page, /تحديث المعاينة/);
  assert.doesNotMatch(page, /معاينة الأعداد الحالية/);
  assert.doesNotMatch(page, /Object\.entries\(counts\)/);
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
      scope: 'purge_deleted_listings',
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

test('maintenance cleanup admits appointed admins before request validation', async () => {
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

      assert.equal(response.status, 400);
      assert.equal(body.error, 'confirmation_required');
    },
  );
});

test('the configured owner account remains protected from appointed admins', () => {
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
  assert.match(updateRoute, /cannot_delete_self/);
  assert.match(updateRoute, /soft_deleted/);
  assert.match(updateRoute, /deletedAt/);
});

test('the users page lets owner-level admins change roles and protects the owner account', () => {
  const page = readProjectFile('app', 'admin', 'users', 'page.tsx');

  assert.match(page, /adminAccessRole === 'owner' \|\| adminAccessRole === 'admin'/);
  assert.match(page, /canChangeRole/);
  assert.match(page, /isOwnerAccount/);
  assert.match(page, /حساب مالك المنصة محميّ/);
  assert.match(page, /href=\{`\/sellers\/\$\{encodeURIComponent\(user\.id\)\}\?source=admin-users`\}/);
  assert.match(page, /عرض صفحة المعلن/);
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
  assert.match(dashboard, /href: '\/admin\/commissions'/);
  assert.match(dashboard, /visible: isOwner/);
  assert.match(commissionsPage, /useAdminAccess\('owner'\)/);
  assert.match(commissionsRoute, /hasVerifiedAdminAccess/);
  assert.match(commissionRoute, /hasVerifiedAdminAccess/);
  assert.match(usersPage, /\.\.\.\(isOwner \? \{ role: draft\.role \} : \{\}\)/);
  assert.match(userRoute, /hasOwnerLevelAdminAccess = await hasVerifiedAdminAccess/);
  assert.match(userRoute, /parsed\.data\.role !== undefined && !hasOwnerLevelAdminAccess/);
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
  assert.match(usersPage, /تعطيل الحساب/);
  assert.match(usersPage, /إعادة تفعيل الحساب/);
  assert.match(usersPage, /حذف نهائي/);
  assert.match(usersPage, /accountStatus: 'active'/);
});

test('admin dashboard admits moderators and renders a scoped moderator view', () => {
  const dashboard = readProjectFile('app', 'admin', 'page.tsx');

  assert.match(dashboard, /useAdminAccess\('moderator'\)/);
  assert.match(dashboard, /isModeratorOnly/);
  assert.match(dashboard, /لوحة المشرف/);
  assert.doesNotMatch(dashboard, /\/api\/moderator\/overview/);
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

test('admin action pages use floating feedback for mutation results', () => {
  const pages = [
    ['app', 'admin', 'listings', 'page.tsx'],
    ['app', 'admin', 'users', 'page.tsx'],
    ['app', 'admin', 'commissions', 'page.tsx'],
    ['app', 'admin', 'moderation', 'page.tsx'],
    ['app', 'admin', 'maintenance', 'page.tsx'],
  ];

  for (const pageSegments of pages) {
    const page = readProjectFile(...pageSegments);

    assert.match(page, /FloatingActionNotice/);
    assert.match(page, /open=\{Boolean\(/);
    assert.match(page, /onDismiss=\{\(\) =>/);
  }

  const listingsPage = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(listingsPage, /type PendingAdminListingAction/);
  assert.match(listingsPage, /loading=\{isSaving\}/);
  assert.match(listingsPage, /loading=\{isDeleting\}/);
  assert.match(listingsPage, /loading=\{isPermanentlyDeleting\}/);
});
