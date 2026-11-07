import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getAppUsageStats, recordSiteVisit } from '@/lib/analytics/site-visits';
import { prisma } from '@/lib/db/prisma';

test('PostgreSQL app receipts are atomic under duplicate requests and rolling activity dedupes across days', async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return t.skip('Requires the disposable loopback PostgreSQL test database.');
  const target = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55432');
  assert.equal(target.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  const visitorId = `analytics-${randomUUID()}`, otherId = `analytics-${randomUUID()}`;
  const sessionId = randomUUID();
  // Reserved fixture dates isolate aggregate expectations from all current traffic.
  const days = ['2044-07-01', '2044-07-11', '2044-07-12'];
  t.after(async () => {
    await prisma.siteVisitUnique.deleteMany({ where: { visitorId: { in: [visitorId, otherId] } } });
    await prisma.siteVisitDaily.deleteMany({ where: { day: { in: days }, platform: { in: ['ios', 'android'] } } });
    await prisma.$disconnect();
  });
  const input = { visitorId, platform: 'ios' as const, sessionId };
  const at = (day: string) => new Date(day + 'T12:00:00Z');
  await Promise.all(Array.from({ length: 8 }, () => recordSiteVisit(input, at(days[0]))));
  let daily = await prisma.siteVisitDaily.findUniqueOrThrow({ where: { day_platform: { day: days[0], platform: 'ios' } } });
  assert.equal(daily.visits, 1);
  assert.equal(daily.uniqueVisitors, 1);
  // S2 is observed but suppressed during S1's active session. Neither its
  // delayed retry nor an old S1 retry may become another visit after idle.
  const suppressedSession = randomUUID();
  await recordSiteVisit({ ...input, sessionId: suppressedSession }, new Date('2044-07-01T12:02:00Z'));
  await recordSiteVisit(input, new Date('2044-07-01T12:33:00Z'));
  await recordSiteVisit({ ...input, sessionId: suppressedSession }, new Date('2044-07-01T13:04:00Z'));
  daily = await prisma.siteVisitDaily.findUniqueOrThrow({ where: { day_platform: { day: days[0], platform: 'ios' } } });
  assert.equal(daily.visits, 1);
  await recordSiteVisit({ ...input, sessionId: randomUUID() }, new Date('2044-07-01T13:35:00Z'));
  daily = await prisma.siteVisitDaily.findUniqueOrThrow({ where: { day_platform: { day: days[0], platform: 'ios' } } });
  assert.equal(daily.visits, 2);
  assert.equal(daily.uniqueVisitors, 1);
  await recordSiteVisit({ ...input, visitorId: otherId }, at(days[0]));
  await recordSiteVisit(input, at(days[1]));
  await recordSiteVisit(input, at(days[2]));
  await recordSiteVisit({ ...input, platform: 'android' }, at(days[2]));
  const usage = await getAppUsageStats(at(days[2]));
  assert.deepEqual([usage.today, usage.last7Days, usage.last30Days], [2, 2, 3]);
  assert.deepEqual(usage.platforms.ios, { today: 1, last7Days: 1, last30Days: 2 });
  assert.deepEqual(usage.platforms.android, { today: 1, last7Days: 1, last30Days: 1 });
});
