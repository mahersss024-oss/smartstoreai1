import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('admin moderation exposes a complete listing report workflow', async () => {
  const source = await readFile(
    new URL('../app/admin/moderation/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /فتح الإعلان/);
  assert.match(source, /رفض البلاغ/);
  assert.match(source, /إيقاف الإعلان/);
  assert.match(source, /حذف الإعلان/);
  // Listing/report decisions now use one report request. Behavioral route,
  // PostgreSQL and browser cases verify its commit/rollback and stale conflict.
  assert.match(source, /await moderateReport\(report\.id, action\)/);
  const reportRoute = await readFile(
    new URL('../app/api/admin/moderation/reports/[reportId]/route.ts', import.meta.url), 'utf8',
  );
  assert.match(reportRoute, /'review', 'dismiss', 'reject_listing', 'delete_listing'/);
  assert.match(reportRoute, /report_already_resolved/);
  assert.match(source, /<ActionConfirmDialog/);
  assert.match(source, /pendingModerationConfirm/);
  assert.match(source, /setPendingModerationConfirm\(\{/);
  assert.match(source, /onConfirm:\s*\(\) =>/);
  assert.doesNotMatch(source, /window\.confirm\(confirmationMessage\)/);
});

test('admin moderation exposes a complete conversation report workflow', async () => {
  const source = await readFile(
    new URL('../app/admin/moderation/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /بلاغات المحادثات/);
  assert.match(source, /تسجيل تحذير إداري/);
  assert.match(source, /تقييد التواصل/);
  assert.match(source, /إغلاق ومنع التواصل/);
  assert.match(source, /عرض حساب المبلّغ/);
  assert.match(source, /عرض الحساب المبلّغ عنه/);
  assert.match(source, /adminAccessRole === 'admin'/);

  const route = await readFile(
    new URL(
      '../app/api/admin/moderation/user-reports/[reportId]/route.ts',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(route, /'warn'/);
  assert.match(route, /'restrict'/);
  assert.match(route, /'close_conversation'/);
  assert.match(route, /hasVerifiedModeratorAccess/);
  assert.match(route, /enforceApiRateLimit/);
  assert.match(route, /report_already_resolved/);
});

test('conversation reports enforce one open report per conversation and reporter', async () => {
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20260917010000_unique_open_conversation_report/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(migration, /UserReport_unique_open_conversation_report/);
  assert.match(migration, /WHERE "status" = 'open' AND "conversationId" IS NOT NULL/);
});
