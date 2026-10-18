import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeReportNotification,
  listReportNotifications,
} from '@/lib/admin/report-notifications';
import { GET, PATCH } from '@/app/api/admin/moderation/route';
import { createSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { listModerationQueuePage } from '@/agent/marketplace/repository';
import { GET as getListings } from '@/app/api/admin/listings/route';

test('notification inbox is bounded and excludes shared viewed events and non-conversation user reports', async () => {
  let sql = '';
  let parameters: unknown[] = [];
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `case-${index}`,
  }));
  const database = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      sql = parts.join('?');
      parameters = values;
      return rows;
    },
  };
  const result = await listReportNotifications(2, 2, database as never);
  assert.equal(result.notifications.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.page, 2);
  assert.deepEqual(parameters, [3, 2]);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /notification\.viewed/);
  assert.match(sql, /conversationId.*IS NOT NULL/);
  assert.match(sql, /r\.status = 'open' OR u\.status = 'open'/);
  assert.doesNotMatch(sql, /UPDATE|DELETE|snapshot/);
});

test('empty inbox does not invent records', async () => {
  const result = await listReportNotifications(1, 20, {
    $queryRaw: async () => [],
  } as never);
  assert.deepEqual(result, { notifications: [], page: 1, hasMore: false });
});

test('shared acknowledgement records the first actor once without resolving or changing a report', async () => {
  const writes: unknown[] = [];
  let locks = 0;
  let existing: { id: string } | null = null;
  const tx = {
    $executeRaw: async () => {
      locks++;
    },
    evidenceCase: {
      findUnique: async () => ({
        id: 'case',
        sourceType: 'Report',
        sourceId: 'report',
        disposedAt: null,
      }),
    },
    report: { findUnique: async () => ({ id: 'report' }) },
    evidenceEvent: {
      findFirst: async () => existing,
      create: async (args: unknown) => {
        writes.push(args);
        existing = { id: 'viewed' };
      },
    },
  };
  const database = {
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  };
  assert.equal(
    await acknowledgeReportNotification('case', 'admin-one', database as never),
    true,
  );
  assert.equal(
    await acknowledgeReportNotification('case', 'admin-two', database as never),
    true,
  );
  assert.equal(locks, 2);
  assert.deepEqual(writes, [
    {
      data: {
        caseId: 'case',
        actorId: 'admin-one',
        action: 'notification.viewed',
        payload: { scope: 'shared' },
      },
    },
  ]);
});

test('missing disposed or deleted sources cannot create an acknowledgement', async () => {
  for (const record of [
    null,
    { disposedAt: new Date() },
    { id: 'case', sourceType: 'Report', sourceId: 'gone', disposedAt: null },
  ]) {
    const tx = {
      $executeRaw: async () => {},
      evidenceCase: { findUnique: async () => record },
      report: { findUnique: async () => null },
    };
    const database = {
      $transaction: async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
    };
    assert.equal(
      await acknowledgeReportNotification('case', 'admin', database as never),
      false,
    );
  }
});

test('conversation notifications use the existing conversation report source', async () => {
  let source: unknown;
  let event: unknown;
  const tx = {
    $executeRaw: async () => {},
    evidenceCase: {
      findUnique: async () => ({
        sourceType: 'UserReport',
        sourceId: 'conversation-report',
        disposedAt: null,
      }),
    },
    userReport: {
      findFirst: async (args: unknown) => {
        source = args;
        return { id: 'conversation-report' };
      },
    },
    evidenceEvent: {
      findFirst: async () => null,
      create: async (args: unknown) => {
        event = args;
      },
    },
  };
  const database = {
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  };
  assert.equal(
    await acknowledgeReportNotification('case', 'moderator', database as never),
    true,
  );
  assert.deepEqual(source, {
    where: { id: 'conversation-report', conversationId: { not: null } },
    select: { id: true },
  });
  assert.equal(
    (event as { data: { actorId: string } }).data.actorId,
    'moderator',
  );
});

test('notification reads and acknowledgements cannot bypass staff authorization', async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    for (const role of [null, 'user']) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (role)
        headers.cookie = createSessionCookie({
          id: 'customer',
          email: 'customer@example.test',
          role,
        });
      assert.equal(
        (
          await GET(
            new Request(
              'http://localhost/api/admin/moderation?view=notifications',
              { headers },
            ),
          )
        ).status,
        role ? 403 : 401,
      );
      assert.equal(
        (
          await PATCH(
            new Request('http://localhost/api/admin/moderation', {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                action: 'notification_viewed',
                caseId: 'case',
              }),
            }),
          )
        ).status,
        role ? 403 : 401,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('focused report navigation excludes the listing review queue and preserves report filters', async (t) => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const original = [
    prisma.listing.findMany,
    prisma.report.findMany,
    prisma.userReport.findMany,
  ];
  const calls: unknown[] = [];
  const reviewQueries: unknown[] = [];
  t.mock.method(prisma, '$queryRaw', async (query: unknown) => {
    reviewQueries.push(query);
    return [];
  });
  prisma.listing.findMany = t.mock.fn(async (args: unknown) => {
    calls.push(args);
    return [];
  }) as typeof prisma.listing.findMany;
  prisma.report.findMany = t.mock.fn(async (args: unknown) => {
    calls.push(args);
    return [];
  }) as typeof prisma.report.findMany;
  prisma.userReport.findMany = t.mock.fn(async (args: unknown) => {
    calls.push(args);
    return [];
  }) as typeof prisma.userReport.findMany;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    await listModerationQueuePage(
      {},
      { reportId: 'conversation-report', sourceType: 'UserReport' },
    );
    assert.equal(reviewQueries.length, 0);
    assert.deepEqual((calls[0] as { where: unknown }).where, {
      id: { in: [] },
    });
    assert.deepEqual((calls[1] as { where: unknown }).where, {
      id: 'conversation-report',
    });
    calls.length = 0;
    await listModerationQueuePage();
    assert.equal(reviewQueries.length, 1);
    assert.equal('where' in (calls[0] as object), false);
    assert.equal('where' in (calls[1] as object), false);
  } finally {
    [
      prisma.listing.findMany,
      prisma.report.findMany,
      prisma.userReport.findMany,
    ] = original as [
      typeof prisma.listing.findMany,
      typeof prisma.report.findMany,
      typeof prisma.userReport.findMany,
    ];
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('seller drilldown uses an exact existing listing source with the same filters and pagination', async (t) => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const originalFind = prisma.listing.findMany;
  const originalCount = prisma.listing.count;
  const reads: Array<{ where: unknown; skip?: number; take?: number }> = [];
  prisma.listing.findMany = t.mock.fn(async (args: unknown) => {
    reads.push(args as (typeof reads)[number]);
    return [];
  }) as typeof prisma.listing.findMany;
  prisma.listing.count = t.mock.fn(async (args: unknown) => {
    reads.push(args as (typeof reads)[number]);
    return 0;
  }) as typeof prisma.listing.count;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const cookie = createSessionCookie({
      id: 'staff',
      email: 'staff@example.test',
      role: 'moderator',
    });
    const response = await getListings(
      new Request(
        'http://localhost/api/admin/listings?sellerId=exact-seller&status=published&page=2&limit=10',
        { headers: { cookie } },
      ),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(reads[0].where, {
      sellerId: 'exact-seller',
      status: 'published',
    });
    assert.deepEqual(reads[1].where, reads[0].where);
    assert.equal(reads[0].skip, 10);
    assert.equal(reads[0].take, 11);
    assert.equal((await response.json()).pagination.total, 0);
  } finally {
    prisma.listing.findMany = originalFind;
    prisma.listing.count = originalCount;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('listing preview exposes stored image variants without fabricating or rewriting sources', async (t) => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const originalFind = prisma.listing.findMany;
  const originalCount = prisma.listing.count;
  const image = {
    id: 'image',
    originalUrl: '/stored/original.webp',
    displayUrl: '/stored/display.webp',
    thumbnailUrl: '/stored/thumbnail.webp',
    isPrimary: true,
  };
  prisma.listing.findMany = t.mock.fn(async () => [
    {
      id: 'listing',
      sellerId: 'seller',
      category: 'other',
      title: 'stored title',
      description: null,
      price: 10,
      priceMode: null,
      city: null,
      condition: 'used',
      status: 'published',
      views: 0,
      messageCount: 0,
      favoriteCount: 0,
      createdAt: new Date('2026-10-18T00:00:00Z'),
      updatedAt: new Date('2026-10-18T00:00:00Z'),
      images: [image],
    },
  ]) as unknown as typeof prisma.listing.findMany;
  prisma.listing.count = t.mock.fn(
    async () => 1,
  ) as typeof prisma.listing.count;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const cookie = createSessionCookie({
      id: 'staff',
      email: 'staff@example.test',
      role: 'moderator',
    });
    const response = await getListings(
      new Request('http://localhost/api/admin/listings', {
        headers: { cookie },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).listings[0].images, [image]);
  } finally {
    prisma.listing.findMany = originalFind;
    prisma.listing.count = originalCount;
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
