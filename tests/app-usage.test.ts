import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppUsageStats, recordSiteVisit } from '@/lib/analytics/site-visits';
import { POST } from '@/app/api/analytics/visit/route';

test('native receipts dedupe retries and short resumes, retain daily unique installs and separate platforms', async t => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const receipts = new Map<string, { lastSeenAt: Date; lastSessionId: string; seenSessionIds: string[] }>();
  const days = new Map<string, { visits: number; uniqueVisitors: number }>();
  let locks = 0;
  const database = { $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
    $executeRaw: async () => { locks++; },
    siteVisitUnique: {
      findUnique: async ({ where }: { where: { day_platform_visitorId: unknown } }) => receipts.get(JSON.stringify(where.day_platform_visitorId)) ?? null,
      upsert: async ({ where, create, update }: { where: { day_platform_visitorId: unknown }; create: { lastSeenAt: Date; lastSessionId: string; seenSessionIds: string[] }; update: { lastSeenAt: Date; lastSessionId: string; seenSessionIds: string[] } }) => {
        const key = JSON.stringify(where.day_platform_visitorId);
        receipts.set(key, receipts.has(key) ? update : create);
      },
    },
    siteVisitDaily: { upsert: async ({ where, create, update }: { where: { day_platform: unknown }; create: { visits: number; uniqueVisitors: number }; update: { visits: { increment: number }; uniqueVisitors: { increment: number } } }) => {
      const key = JSON.stringify(where.day_platform), old = days.get(key);
      days.set(key, old ? { visits: old.visits + update.visits.increment, uniqueVisitors: old.uniqueVisitors + update.uniqueVisitors.increment } : { visits: create.visits, uniqueVisitors: create.uniqueVisitors });
    } },
  }) };
  const receipt = { visitorId: 'installation-0000001', platform: 'ios' as const, sessionId: 'session-0000000001' };
  const record = (input: typeof receipt, at: string) => recordSiteVisit(input, new Date(at), database as never);
  await record(receipt, '2026-11-07T12:00:00Z');
  await record(receipt, '2026-11-07T12:01:00Z');
  await record({ ...receipt, sessionId: 'session-0000000002' }, '2026-11-07T12:02:00Z');
  assert.deepEqual([...days.values()], [{ visits: 1, uniqueVisitors: 1 }]);
  await record({ ...receipt, sessionId: 'session-0000000003' }, '2026-11-07T12:33:00Z');
  assert.deepEqual([...days.values()], [{ visits: 2, uniqueVisitors: 1 }]);
  await record({ ...receipt, sessionId: 'session-0000000003' }, '2026-11-07T14:00:00Z');
  assert.deepEqual([...days.values()], [{ visits: 2, uniqueVisitors: 1 }], 'a repeated request stays idempotent after idle');
  await record(receipt, '2026-11-07T15:00:00Z');
  assert.deepEqual([...days.values()], [{ visits: 2, uniqueVisitors: 1 }], 'a delayed older S1 cannot count again after S2/S3');
  await record(receipt, '2026-11-07T21:00:00Z');
  await recordSiteVisit({ ...receipt, platform: 'android' }, new Date('2026-11-07T21:00:00Z'), database as never);
  assert.deepEqual([...days.values()], [{ visits: 2, uniqueVisitors: 1 }, { visits: 1, uniqueVisitors: 1 }, { visits: 1, uniqueVisitors: 1 }]);
  assert.equal(locks, 8);
  await recordSiteVisit({ visitorId: receipt.visitorId, path: '/admin/users' }, new Date(), database as never);
  assert.equal(locks, 8, 'admin page visits are excluded server-side too');
});

test('rolling app activity counts distinct installations in each window rather than summing daily uniques', async t => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  let query = '', params: unknown[] = [];
  const stats = await getAppUsageStats(new Date('2026-11-07T21:10:00Z'), { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    query = parts.join('?'); params = values;
    return [{ platform: 'ios', today: BigInt(2), last7Days: BigInt(3), last30Days: BigInt(4) }, { platform: 'android', today: BigInt(1), last7Days: BigInt(2), last30Days: BigInt(5) }];
  } } as never);
  assert.match(query, /COUNT\(DISTINCT "visitorId"\)/);
  assert.match(query, /platform IN \('ios', 'android'\)/);
  assert.deepEqual(params, ['2026-11-08', '2026-11-02', '2026-10-10', '2026-11-08']);
  assert.deepEqual([stats.today, stats.last7Days, stats.last30Days], [3, 5, 9]);
  assert.equal(stats.platforms.ios.last30Days, 4);
});

test('analytics contract keeps empty web requests and validates native identities without requiring sign-in', async t => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const request = (body?: string) => POST(new Request('https://example.test/api/analytics/visit', { method: 'POST', body }));
  const web = await request();
  assert.equal(web.status, 200);
  assert.match(web.headers.get('set-cookie') ?? '', /smartstore_visitor_id/);
  assert.equal((await request('{')).status, 400);
  assert.equal((await request(JSON.stringify({ platform: 'ios' }))).status, 400);
  assert.equal((await request(JSON.stringify({ platform: 'windows', visitorId: 'installation-000001' }))).status, 400);
  const native = await request(JSON.stringify({ platform: 'ios', visitorId: 'installation-000001', sessionId: 'session-0000000001' }));
  assert.equal(native.status, 200);
  assert.equal(native.headers.get('set-cookie'), null);
  assert.match(native.headers.get('cache-control') ?? '', /no-store/);
});
