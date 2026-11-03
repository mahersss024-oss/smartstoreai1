import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { GET as readMaintenance, POST as runMaintenanceCleanup, PUT as putMaintenance, PATCH as patchMaintenance, DELETE as deleteMaintenance } from '@/app/api/admin/maintenance/route';
import { executeMaintenanceCleanup } from '@/lib/admin/maintenance';
import { prisma } from '@/lib/db/prisma';
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

test('admin dashboard keeps section navigation in the shared sidebar only', () => {
  const page = readProjectFile('app', 'admin', 'page.tsx');
  const sidebar = readProjectFile('components', 'admin', 'admin-shell.tsx');
  assert.doesNotMatch(page, /adminSections|<nav/);
  assert.match(sidebar, /\/admin\/users/);
  assert.match(sidebar, /العملاء/);
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
  assert.match(accessHook, /useAuthSession/);
  assert.match(accessHook, /next\.authenticated && hasRequiredRole/);
  assert.doesNotMatch(accessHook, /window\.location\.assign/, 'the admin entry owns explicit sign-in');
});

test('admin dashboard stays focused on required statistics and administrative navigation', () => {
  const dashboard = readProjectFile('app', 'admin', 'page.tsx');
  const usersPage = readProjectFile('app', 'admin', 'users', 'page.tsx');
  const moderationPage = readProjectFile('app', 'admin', 'moderation', 'page.tsx');
  const listingsPage = readProjectFile('app', 'admin', 'listings', 'page.tsx');
  const commissionsPage = readProjectFile('app', 'admin', 'commissions', 'page.tsx');

  assert.doesNotMatch(dashboard, /aria-label="أقسام الإدارة"/);
  assert.match(dashboard, /WorkspaceDashboard/);
  assert.doesNotMatch(dashboard, /admin-work-queue/);
  assert.doesNotMatch(dashboard, /StatCard/);
  assert.doesNotMatch(dashboard, /StatusBlock/);
  assert.match(dashboard, /\/api\/admin\/overview/);
  assert.doesNotMatch(dashboard, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(usersPage, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(moderationPage, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(listingsPage, /\/hamad-market-logo\.webp/);
  assert.doesNotMatch(commissionsPage, /\/hamad-market-logo\.webp/);
  assert.match(dashboard, /إجمالي المستخدمين/);
  assert.match(dashboard, /المستخدمون النشطون/);
  assert.match(dashboard, /الإعلانات المنشورة/);
  assert.match(dashboard, /البلاغات المفتوحة/);
  assert.match(usersPage, /className="admin-section"/);
  assert.match(usersPage, /className="admin-record"/);
  assert.doesNotMatch(usersPage, /grid gap-4 rounded-md border bg-white p-4 shadow-sm/);
});

test('admin users page keeps long account identifiers inside android pwa viewport', () => {
  const page = readProjectFile('app', 'admin', 'users', 'page.tsx');

  assert.match(page, /<main className="[^"]*overflow-x-hidden/);
  assert.match(page, /<AdminPageHeading/);
  assert.match(page, /className="[^"]*min-w-0 flex-1 items-center gap-3/);
  assert.match(page, /<TechnicalDetails title="معرّف الحساب"/);
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
    const guardIndex = pageSegments[2] === 'maintenance' ? page.indexOf('verifyOwner') : page.indexOf('verifyAdminAccess');
    if (pageSegments[2] === 'maintenance') assert.match(page, /current\.user\?\.role === 'owner' && current\.user\.id === ownerId/);
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

  for (const section of ['maintenance', 'site-message']) {
    const ownerRoute = readProjectFile('app', 'api', 'admin', section, 'route.ts');
    assert.match(ownerRoute, /isPlatformOwner/);
    assert.match(ownerRoute, /auth_required/);
    assert.match(ownerRoute, /owner_required/);
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

test('customer and moderation image deletion stay scoped while maintenance cannot schedule storage deletion', () => {
  const adminListingRoute = readProjectFile('app', 'api', 'admin', 'listings', '[listingId]', 'route.ts');
  const maintenanceRoute = readProjectFile('app', 'api', 'admin', 'maintenance', 'route.ts');
  const imageRoute = readProjectFile('app', 'api', 'marketplace', 'listings', '[listingId]', 'images', '[imageId]', 'route.ts');
  assert.match(adminListingRoute, /hasVerifiedModeratorAccess/);
  assert.match(adminListingRoute, /deleteStoredListingImagesBestEffort/);
  assert.match(imageRoute, /getAuthSession/); assert.match(imageRoute, /session\.user\.id/);
  assert.match(imageRoute, /deleteListingImageForSeller/);
  assert.match(maintenanceRoute, /maintenance_read_only/);
  assert.doesNotMatch(maintenanceRoute, /executeMaintenanceCleanup|executeMarketReset|schedulePendingImageObjectCleanup|publishRealtimeEvent/);
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

test('admin listings offer permanent deletion only for deleted listings', () => {
  const page = readProjectFile('app', 'admin', 'listings', 'page.tsx');

  assert.match(page, /listing\.status === 'deleted'/);
  assert.match(page, /حذف نهائي/);
  assert.match(page, /لا يمكن التراجع عن هذا الإجراء/);
  assert.match(page, /body: JSON\.stringify\(\{ status: 'deleted' \}\)/);
  assert.match(page, /method: 'DELETE'/);
});

test('active commission and moderation mutations are rate limited while maintenance mutations are denied', () => {
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
  assert.match(maintenanceRoute, /maintenance_read_only/);
  assert.match(maintenanceRoute, /owner_maintenance_monitoring/);
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

test('maintenance monitoring has no reachable cleanup, reset or storage mutation path', () => {
  const route = readProjectFile('app', 'api', 'admin', 'maintenance', 'route.ts');
  const maintenance = readProjectFile('lib', 'admin', 'maintenance.ts');
  assert.match(route, /maintenance_read_only/);
  assert.match(route, /getMaintenanceOverview/);
  assert.doesNotMatch(route, /executeMaintenanceCleanup|executeMarketReset|schedulePendingImageObjectCleanup/);
  assert.doesNotMatch(maintenance, /(?:prisma|tx)\.[a-zA-Z]+\.(?:delete|deleteMany|update|updateMany|upsert|create)\(/);
  assert.doesNotMatch(maintenance, /DELETE FROM|TRUNCATE|enqueueImageObjectCleanup|pg_advisory_xact_lock|FOR UPDATE/);
});

test('maintenance page renders counters and read-only tools without purge, reset or editable-message forms', () => {
  const page = readProjectFile('app', 'admin', 'maintenance', 'page.tsx');
  assert.match(page, /useAdminAccess\('owner'\)/);
  assert.match(page, /deletedListings/); assert.match(page, /deletedListingImages/);
  assert.match(page, /DatabaseExplorer/); assert.match(page, /RecoveryPanel/);
  assert.doesNotMatch(page, /MarketResetPanel|previewToken|purge_deleted_listings|method:\s*'(?:POST|PATCH|PUT|DELETE)'/);
  assert.doesNotMatch(page, /<form|<Textarea|<Input|<textarea|type="checkbox"/);
  assert.doesNotMatch(page, /تنفيذ التنظيف|حذف بيانات السوق|حذف نهائي للإعلانات/);
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

function maintenanceCleanupRequest(
  email: string | null,
  role = 'admin',
  payload: Record<string, unknown> = { scope: 'purge_deleted_listings', confirmation: 'confirm' },
) {
  return new Request('https://smartstore.test/api/admin/maintenance', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(email ? { cookie: createSessionCookie({ id: `google:${email}`, email, role }) } : {}),
    },
    body: JSON.stringify(payload),
  });
}

const isolatedMaintenanceEnv = {
  NODE_ENV: 'production',
  SMARTSTORE_MARKETPLACE_STORE: 'database',
  AUTH_SECRET: 'test-admin-maintenance-secret',
  SMARTSTORE_ADMIN_EMAILS: 'owner@example.com',
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

const cleanupPayload = {
  scope: 'purge_deleted_listings',
  confirmation: '\u062a\u0646\u0638\u064a\u0641',
  reason: 'Remove obsolete test fixtures',
  previewToken: 'invalid-preview',
};

function maintenanceReadRequest(email: string | null, role: string) {
  return new Request('https://smartstore.test/api/admin/maintenance', {
    headers: email ? { cookie: createSessionCookie({ id: `google:${email}`, email, role }) } : {},
  });
}

test('maintenance reads and writes require the configured owner even when legacy cleanup flag is enabled', async (t) => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withMaintenanceEnv({ ...isolatedMaintenanceEnv, SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: '1' }, async () => {
    for (const actor of [
      { email: null, role: 'user', status: 401, error: 'auth_required' },
      { email: 'user@example.com', role: 'user', status: 403, error: 'owner_required' },
      { email: 'moderator@example.com', role: 'moderator', status: 403, error: 'owner_required' },
      { email: 'appointed-admin@example.com', role: 'admin', status: 403, error: 'owner_required' },
      { email: 'owner-claim@example.com', role: 'owner', status: 403, error: 'owner_required' },
    ]) {
      for (const response of [
        await readMaintenance(maintenanceReadRequest(actor.email, actor.role)),
        await runMaintenanceCleanup(maintenanceCleanupRequest(actor.email, actor.role, cleanupPayload)),
      ]) {
        assert.equal(response.status, actor.status);
        assert.equal((await response.json()).error, actor.error);
        assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      }
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('maintenance reads require database storage while legacy writes are denied before any connection', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withMaintenanceEnv({ ...isolatedMaintenanceEnv, SMARTSTORE_MARKETPLACE_STORE: 'file' }, async () => {
    const read = await readMaintenance(maintenanceReadRequest('owner@example.com', 'admin'));
    assert.equal(read.status, 503); assert.equal((await read.json()).error, 'database_required');
    const denied = await runMaintenanceCleanup(maintenanceCleanupRequest('owner@example.com', 'admin', cleanupPayload));
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'maintenance_read_only');
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('maintenance monitoring returns counts from a read-only transaction and issues no cleanup tokens', async t => {
  const statements: string[] = [];
  const calls: string[] = [];
  const data = Object.freeze({ listings: 11, images: 22, reports: 33, userReports: 44, searches: 55, keys: 66, reviews: 77 });
  const counted = (name: keyof typeof data) => ({ count: async () => { calls.push(name); return data[name]; } });
  const tx = { $executeRaw: async (strings: TemplateStringsArray) => { statements.push(strings.join('?')); return 0; },
    listing: counted('listings'), listingImage: counted('images'), report: counted('reports'), userReport: counted('userReports'),
    marketplaceSearchState: counted('searches'), apiIdempotencyKey: counted('keys'), adminAuditLog: counted('reviews') };
  const transaction = t.mock.method(prisma, '$transaction', async (work: (value: unknown) => Promise<unknown>) => work(tx));
  await withMaintenanceEnv({ ...isolatedMaintenanceEnv, SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: '1' }, async () => {
    const response = await readMaintenance(maintenanceReadRequest('owner@example.com', 'admin'));
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    const payload = await response.json();
    assert.equal(payload.monitoringOnly, true); assert.equal(payload.productionCleanupEnabled, false);
    assert.deepEqual(payload.scopes, []);
    assert.deepEqual(payload.counts, { deletedListings: 11, deletedListingImages: 22, closedReports: 33,
      closedUserReports: 44, searchStates: 55, idempotencyKeys: 66, modelReviews: 77 });
    assert.doesNotMatch(JSON.stringify(payload), /previewToken|confirmation|affectedIds/);
  });
  assert.equal(transaction.mock.callCount(), 1); assert.equal(calls.length, 7);
  assert.match(statements[0], /SET TRANSACTION READ ONLY/);
  assert.ok(statements.every(statement => /^SET /i.test(statement)));
  assert.deepEqual(data, { listings: 11, images: 22, reports: 33, userReports: 44, searches: 55, keys: 66, reviews: 77 });
});

test('the obsolete full-reset preview is blocked before reading or signing database contents', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withMaintenanceEnv({ ...isolatedMaintenanceEnv, SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: '1' }, async () => {
    const response = await readMaintenance(new Request('https://smartstore.test/api/admin/maintenance?resource=market_reset',
      maintenanceReadRequest('owner@example.com', 'admin')));
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'maintenance_read_only');
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('legacy maintenance payloads cannot delete records even with old enable flags and valid acknowledgements', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  const removals = [prisma.user, prisma.listing, prisma.evidenceCase, prisma.evidenceAsset, prisma.report,
    prisma.userReport, prisma.commission, prisma.adminAuditLog].map(delegate => {
      const previous = Object.getOwnPropertyDescriptor(delegate, 'deleteMany');
      const blocked = t.mock.fn(async () => { throw new Error('unexpected_row_deletion'); });
      Object.defineProperty(delegate, 'deleteMany', { configurable: true, writable: true, value: blocked });
      t.after(() => { if (previous) Object.defineProperty(delegate, 'deleteMany', previous); else Reflect.deleteProperty(delegate, 'deleteMany'); });
      return blocked;
    });
  await withMaintenanceEnv({ ...isolatedMaintenanceEnv, SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: '1' }, async () => {
    for (const payload of [cleanupPayload, { ...cleanupPayload, scope: 'closed_reports' },
      { ...cleanupPayload, scope: 'closed_user_reports' }, { ...cleanupPayload, scope: 'search_state' },
      { ...cleanupPayload, scope: 'old_model_reviews' },
      { action: 'market_reset', confirmation: 'حذف بيانات السوق والإبقاء على المستخدمين', reason: 'old saved request',
        previewToken: 'previously-valid-token', backupConfirmed: true, includeProtectedData: true },
      { action: 'execute_sql', sql: 'TRUNCATE TABLE "Listing"' }]) {
      const response = await runMaintenanceCleanup(maintenanceCleanupRequest('owner@example.com', 'admin', payload));
      assert.equal(response.status, 403); assert.equal((await response.json()).error, 'maintenance_read_only');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
  });
  assert.equal(transaction.mock.callCount(), 0); assert.ok(removals.every(mock => mock.mock.callCount() === 0));
});

test('all maintenance mutation verbs reject owners without reading the request body', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withMaintenanceEnv(isolatedMaintenanceEnv, async () => {
    for (const [method, handler] of [['POST', runMaintenanceCleanup], ['PUT', putMaintenance], ['PATCH', patchMaintenance], ['DELETE', deleteMaintenance]] as const) {
      const request = new Request('https://smartstore.test/api/admin/maintenance', { method,
        headers: { cookie: createSessionCookie({ id: 'owner', email: 'owner@example.com', role: 'admin' }) } });
      Object.defineProperty(request, 'json', { value: () => { throw new Error('body_must_not_be_consumed'); } });
      const response = await handler(request);
      assert.equal(response.status, 403); assert.equal((await response.json()).error, 'maintenance_read_only');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('direct legacy cleanup execution is permanently denied before creating a transaction', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withMaintenanceEnv({ ...isolatedMaintenanceEnv, SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP: '1' }, async () => {
    await assert.rejects(executeMaintenanceCleanup({ ...cleanupPayload, scope: 'purge_deleted_listings', actorId: 'owner' }),
      error => error instanceof Error && error.message === 'maintenance_read_only');
  });
  assert.equal(transaction.mock.callCount(), 0);
});

test('repeated owner cleanup attempts remain denied and never become an executable operation', async t => {
  const transaction = t.mock.method(prisma, '$transaction', async () => { throw new Error('unexpected_database_access'); });
  await withMaintenanceEnv(isolatedMaintenanceEnv, async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await runMaintenanceCleanup(maintenanceCleanupRequest('owner@example.com'));
      assert.equal(response.status, 403); assert.equal((await response.json()).error, 'maintenance_read_only');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
  });
  assert.equal(transaction.mock.callCount(), 0);
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
  const shell = readProjectFile('components', 'admin', 'admin-shell.tsx');
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
  assert.match(shell, /href: '\/admin\/commissions'/);
  assert.match(shell, /section\.staff \|\| canManage/);
  assert.match(shell, /adminAccessRole === 'admin' \|\| adminAccessRole === 'owner'/);
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
  assert.match(dashboard, /canManageUsers/);
  assert.match(dashboard, /المؤشرات العامة متاحة لإدارة المنصة فقط/);
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
