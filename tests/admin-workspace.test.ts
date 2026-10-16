import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getAdminWorkspace, workspaceMonth } from '@/lib/admin/workspace';
import { GET } from '@/app/api/admin/overview/route';
import { createSessionCookie } from '@/lib/auth/session';

test('workspace month is validated and bounded to one calendar month', () => {
  assert.equal(workspaceMonth('2026-13'), null);
  assert.equal(workspaceMonth('2026-00'), null);
  assert.equal(workspaceMonth('2026-1'), null);
  assert.equal(workspaceMonth('2026-10-01'), null);
  assert.equal(workspaceMonth('not-a-date'), null);
  assert.equal(
    workspaceMonth('2026-12')?.end.toISOString(),
    '2026-12-31T21:00:00.000Z',
  );
  assert.equal(
    workspaceMonth('2026-10')?.start.toISOString(),
    '2026-09-30T21:00:00.000Z',
  );
  assert.equal(
    workspaceMonth(null, new Date('2026-09-30T22:00:00Z'))?.month,
    '2026-10',
  );
  assert.equal(
    workspaceMonth(null, new Date('2026-10-17T00:00:00Z'))?.month,
    '2026-10',
  );
});

test('workspace reads bounded existing records without snapshots or database writes', async () => {
  const range = workspaceMonth('2026-10')!;
  const calls: Record<string, unknown> = {};
  const database = {
    listing: {
      groupBy: async (args: unknown) => {
        calls.listing = args;
        return [{ status: 'pending', _count: { _all: 3 } }];
      },
    },
    commission: {
      groupBy: async () => [
        {
          status: 'due',
          _count: { _all: 2 },
          _sum: { commissionAmount: { toString: () => '42.50' } },
        },
      ],
    },
    evidenceCase: {
      groupBy: async (args: unknown) => {
        calls.evidence = args;
        return [{ captureStatus: 'incomplete', _count: { _all: 1 } }];
      },
      findMany: async (args: unknown) => {
        calls.retention = args;
        return Array.from({ length: 101 }, (_, i) => ({
          id: String(i),
          sourceType: 'Report',
          sourceId: `report-${i}`,
          retainUntil: new Date('2026-10-20T00:00:00Z'),
          legalHold: i === 0,
        }));
      },
    },
    siteVisitDaily: {
      findMany: async (args: unknown) => {
        calls.visits = args;
        return [{ day: '2026-10-15', visits: 9, uniqueVisitors: 4 }];
      },
    },
    siteMessage: {
      findUnique: async () => ({
        isEnabled: true,
        expiresAt: new Date('2026-10-31T00:00:00Z'),
      }),
    },
  };
  const data = await getAdminWorkspace(range, database as never);
  assert.equal(data.commissions[0].amount, '42.50');
  assert.deepEqual(data.visits, [
    { day: '2026-10-15', visits: 9, uniqueVisitors: 4 },
  ]);
  assert.equal(data.events.length, 101);
  assert.equal(data.hasMoreEvents, true);
  assert.match(data.events[0].title, /الإتلاف معلّق/);
  assert.equal(data.events.at(-1)?.href, '/admin/maintenance');
  assert.equal((calls.retention as { take: number }).take, 101);
  assert.deepEqual((calls.retention as { where: unknown }).where, {
    disposedAt: null,
    retainUntil: { gte: range.start, lt: range.end },
  });
  assert.deepEqual((calls.visits as { where: unknown }).where, {
    day: { gte: '2026-10-01', lt: '2026-11-01' },
  });
  assert.deepEqual((calls.evidence as { where: unknown }).where, {
    disposedAt: null,
  });
  assert.doesNotMatch(JSON.stringify(calls), /snapshot|participantIds/);
});

test('empty workspace is empty rather than invented sample data', async () => {
  const empty = { groupBy: async () => [], findMany: async () => [] };
  const data = await getAdminWorkspace(workspaceMonth('2026-10')!, {
    listing: empty,
    commission: empty,
    evidenceCase: empty,
    siteVisitDaily: empty,
    siteMessage: {
      findUnique: async () => ({
        isEnabled: false,
        expiresAt: new Date('2026-10-20'),
      }),
    },
  } as never);
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.visits, []);
  assert.deepEqual(data.commissions, []);
  assert.equal(data.hasMoreEvents, false);
});

test('workspace query cannot bypass the existing admin authorization', async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const url = 'http://localhost/api/admin/overview?view=workspace&month=bad';
    assert.equal((await GET(new Request(url))).status, 401);
    for (const role of ['user', 'moderator']) {
      const cookie = createSessionCookie({
        id: 'workspace-user',
        email: 'workspace-user@example.test',
        role,
      }).split(';')[0];
      assert.equal(
        (await GET(new Request(url, { headers: { Cookie: cookie } }))).status,
        403,
      );
    }
    const cookie = createSessionCookie({
      id: 'workspace-admin',
      email: 'workspace-admin@example.test',
      role: 'admin',
    }).split(';')[0];
    assert.equal(
      (await GET(new Request(url, { headers: { Cookie: cookie } }))).status,
      400,
    );
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('template integration is read-only and retains existing routes and theme', async () => {
  const shell = await readFile(
    new URL('../components/admin/admin-shell.tsx', import.meta.url),
    'utf8',
  );
  const service = await readFile(
    new URL('../lib/admin/workspace.ts', import.meta.url),
    'utf8',
  );
  const calendar = await readFile(
    new URL('../components/admin/workspace-calendar.tsx', import.meta.url),
    'utf8',
  );
  for (const route of [
    'listings',
    'moderation',
    'users',
    'commissions',
    'audit-log',
    'maintenance',
  ])
    assert.ok(shell.includes(`/admin/${route}`));
  assert.match(shell, /ThemeToggle/);
  assert.doesNotMatch(shell, /ThemeProvider|localStorage|next-intl/);
  assert.doesNotMatch(service, /\.(create|update|delete|upsert|executeRaw)\(/);
  assert.match(calendar, /editable=\{false\}/);
  assert.match(calendar, /selectable=\{false\}/);
});
