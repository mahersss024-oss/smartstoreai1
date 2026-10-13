import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getAdminOverview } from '@/lib/admin/overview';
import { authenticatedUserActiveWindowMs } from '@/lib/auth/session';
import { isSiteMessageVisible } from '@/lib/site-message';

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('admin overview calculates the four required database metrics with actual statuses', async () => {
  const calls: Array<{ delegate: string; args: unknown }> = [];
  let userCall = 0;
  const database = {
    user: { count: async (args: unknown) => {
      calls.push({ delegate: 'user', args });
      userCall += 1;
      return userCall === 1 ? 12 : 4;
    } },
    listing: { count: async (args: unknown) => {
      calls.push({ delegate: 'listing', args });
      return 7;
    } },
    report: { count: async (args: unknown) => {
      calls.push({ delegate: 'report', args });
      return 2;
    } },
    userReport: { count: async (args: unknown) => {
      calls.push({ delegate: 'userReport', args });
      return 3;
    } },
  };
  const now = new Date('2026-09-27T12:00:00.000Z');
  const overview = await getAdminOverview(now, database as never);

  assert.deepEqual(overview, {
    totalUsers: 12,
    activeUsers: 4,
    publishedListings: 7,
    openReports: 5,
  });
  assert.deepEqual(calls[0], { delegate: 'user', args: { where: { deletedAt: null } } });
  assert.deepEqual(calls[1], {
    delegate: 'user',
    args: { where: { deletedAt: null, lastActiveAt: { gte: new Date(now.getTime() - authenticatedUserActiveWindowMs) } } },
  });
  assert.deepEqual(calls[2], { delegate: 'listing', args: { where: { status: 'published' } } });
  assert.deepEqual(calls[3], { delegate: 'report', args: { where: { status: 'open' } } });
  assert.deepEqual(calls[4], {
    delegate: 'userReport',
    args: { where: { status: 'open', conversationId: { not: null } } },
  });
});

test('authenticated activity uses the real session window and throttles writes', async () => {
  const sessionRoute = await source('app/api/auth/session/route.ts');
  const schema = await source('prisma/schema.prisma');

  assert.equal(authenticatedUserActiveWindowMs, 14 * 24 * 60 * 60 * 1000);
  assert.match(schema, /lastActiveAt\s+DateTime\?/);
  assert.match(sessionRoute, /5 \* 60 \* 1000/);
  assert.match(sessionRoute, /lastActiveAt: \{ lt:/);
  assert.match(sessionRoute, /deletedAt: null/);
});

test('audit log is server protected, paginated, filterable and read-only', async () => {
  const route = await source('app/api/admin/audit-log/route.ts');
  const page = await source('app/admin/audit-log/page.tsx');

  assert.match(route, /hasVerifiedAdminAccess/);
  assert.match(route, /parsePaginationFromRequest/);
  assert.match(route, /orderBy: \[\{ createdAt: 'desc' \}/);
  assert.match(route, /admin:/);
  assert.match(route, /actionValue/);
  assert.match(route, /createdAt:/);
  assert.doesNotMatch(route, /export async function (PATCH|POST|PUT|DELETE)/);
  assert.match(page, /سجل الإدارة/);
  assert.match(page, /useAdminAccess\('admin'\)/);
  const adminPage = await source('app/admin/page.tsx');
  assert.match(adminPage, /value: null/);
  assert.match(adminPage, /absolute inset-x-0 top-1\/2/);
  assert.match(adminPage, /prefetch=\{false\}/);
  assert.match(page, /prefetch=\{false\}/);
});

test('site message visibility honors activation and expiration', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.equal(isSiteMessageVisible({ isEnabled: true, expiresAt: null }, now), true);
  assert.equal(isSiteMessageVisible({ isEnabled: false, expiresAt: null }, now), false);
  assert.equal(isSiteMessageVisible({ isEnabled: true, expiresAt: new Date('2026-09-27T11:59:59.000Z') }, now), false);
  assert.equal(isSiteMessageVisible({ isEnabled: true, expiresAt: new Date('2026-09-27T12:00:01.000Z') }, now), true);
});

test('site message updates require owner-level admin access, transactional and audited', async () => {
  const route = await source('app/api/admin/site-message/route.ts');
  const banner = await source('components/site-message-banner.tsx');
  const homeOnly = await source('components/site-message-home-only.tsx');
  const layout = await source('app/layout.tsx');
  const maintenance = await source('app/admin/maintenance/page.tsx');

  assert.match(route, /hasVerifiedAdminAccess/);
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /action: 'update_site_message'/);
  assert.match(route, /previous:/);
  assert.match(route, /next:/);
  assert.match(route, /expiration_must_be_future/);
  assert.match(banner, /getActiveSiteMessage/);
  assert.match(banner, /role="status"/);
  assert.match(homeOnly, /usePathname/);
  assert.match(homeOnly, /pathname !== '\/'/);
  assert.match(layout, /<SiteMessageHomeOnly>/);
  assert.match(maintenance, /رسالة الموقع/);
  assert.doesNotMatch(maintenance, /localStorage/);
});

test('migration adds only the required activity, audit and site message storage', async () => {
  const migration = await source('prisma/migrations/20260927100000_admin_dashboard_audit_site_message/migration.sql');

  assert.match(migration, /ADD COLUMN "lastActiveAt"/);
  assert.match(migration, /CREATE TABLE "SiteMessage"/);
  assert.match(migration, /AdminAuditLog_action_createdAt_idx/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /Notification|Payment|Content/);
});

test('existing report creation and resolution continue to use open status in database workflows', async () => {
  const repository = await source('agent/marketplace/repository.ts');
  const listingReportRoute = await source('app/api/marketplace/listings/[listingId]/reports/route.ts');
  const conversationReportRoute = await source('app/api/marketplace/users/[userId]/reports/route.ts');

  assert.match(listingReportRoute, /reportListing/);
  assert.match(conversationReportRoute, /reportUserDirect/);
  assert.match(repository, /status: UserReportStatus =/);
  assert.match(repository, /existing\.status !== 'open'/);
  assert.match(repository, /status === 'reviewed' \? 'review_report' : 'dismiss_report'/);
});
