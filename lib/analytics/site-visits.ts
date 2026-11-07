import type { AnalyticsPlatform, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const siteVisitorCookieName = 'smartstore_visitor_id';
export const appSessionIdleMs = 30 * 60_000;
const maxAppSessionReceiptsPerDay = 128;

export function getSaudiDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit', month: '2-digit', timeZone: 'Asia/Riyadh', year: 'numeric',
  }).format(now);
}

function recentDay(count: number, now: Date) {
  return getSaudiDay(new Date(now.getTime() - (count - 1) * 86_400_000));
}

/** Anonymous installation receipts are independent of sign-in and contain no account identity. */
export async function recordSiteVisit(input: {
  visitorId: string;
  path?: string;
  platform?: AnalyticsPlatform;
  sessionId?: string;
}, now = new Date(), database: Pick<PrismaClient, '$transaction'> = prisma) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return;
  const platform = input.platform ?? 'web';
  if (platform === 'web' && (input.path === '/admin' || input.path?.startsWith('/admin/'))) return;
  const day = getSaudiDay(now);
  await database.$transaction(async tx => {
    // Serialize only this installation, including simultaneous first requests.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(771206, hashtext(${platform + ':' + input.visitorId}))`;
    const key = { day, platform, visitorId: input.visitorId };
    const receipt = await tx.siteVisitUnique.findUnique({ where: { day_platform_visitorId: key } });
    const sessions = receipt?.seenSessionIds ?? [];
    const unseenSession = Boolean(input.sessionId && !sessions.includes(input.sessionId) && receipt?.lastSessionId !== input.sessionId);
    const hasCapacity = sessions.length < maxAppSessionReceiptsPerDay;
    const seenSessionIds = platform !== 'web' && input.sessionId && unseenSession && hasCapacity
      ? [...sessions, input.sessionId] : sessions;
    // Remember suppressed resumes too: an old retry must not become a new session
    // after a later receipt. Saturation fails closed instead of growing unbounded.
    const countVisit = platform === 'web' || !receipt ||
      (unseenSession && hasCapacity && now.getTime() - receipt.lastSeenAt.getTime() >= appSessionIdleMs);
    await tx.siteVisitUnique.upsert({
      where: { day_platform_visitorId: key },
      create: { ...key, lastSeenAt: now, lastSessionId: input.sessionId, seenSessionIds },
      update: { lastSeenAt: now, lastSessionId: input.sessionId, seenSessionIds },
    });
    if (countVisit) await tx.siteVisitDaily.upsert({
      where: { day_platform: { day, platform } },
      create: { day, platform, visits: 1, uniqueVisitors: receipt ? 0 : 1 },
      update: { visits: { increment: 1 }, uniqueVisitors: { increment: receipt ? 0 : 1 } },
    });
  });
}

type AppUsageCounts = { today: number; last7Days: number; last30Days: number };
export type AppUsageStats = AppUsageCounts & {
  platforms: { ios: AppUsageCounts; android: AppUsageCounts };
};

export async function getAppUsageStats(now = new Date(), database: Pick<PrismaClient, '$queryRaw'> = prisma): Promise<AppUsageStats> {
  const empty = () => ({ today: 0, last7Days: 0, last30Days: 0 });
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database')
    return { ...empty(), platforms: { ios: empty(), android: empty() } };
  const today = getSaudiDay(now), since7 = recentDay(7, now), since30 = recentDay(30, now);
  // Count each installation once per window, never sum daily unique counts.
  const rows = await database.$queryRaw<Array<{ platform: 'ios' | 'android'; today: bigint; last7Days: bigint; last30Days: bigint }>>`
    SELECT platform,
      COUNT(DISTINCT "visitorId") FILTER (WHERE day = ${today}) AS today,
      COUNT(DISTINCT "visitorId") FILTER (WHERE day >= ${since7}) AS "last7Days",
      COUNT(DISTINCT "visitorId") AS "last30Days"
    FROM "SiteVisitUnique"
    WHERE platform IN ('ios', 'android') AND day >= ${since30} AND day <= ${today}
    GROUP BY platform
  `;
  const platforms = { ios: empty(), android: empty() };
  for (const row of rows) platforms[row.platform] = {
    today: Number(row.today), last7Days: Number(row.last7Days), last30Days: Number(row.last30Days),
  };
  return {
    today: platforms.ios.today + platforms.android.today,
    last7Days: platforms.ios.last7Days + platforms.android.last7Days,
    last30Days: platforms.ios.last30Days + platforms.android.last30Days,
    platforms,
  };
}

/** Legacy website statistics remain website-only. Unique values are daily uniques. */
export async function getSiteVisitStats() {
  const now = new Date();
  const rows = process.env.SMARTSTORE_MARKETPLACE_STORE === 'database'
    ? await prisma.siteVisitDaily.findMany({ where: { platform: 'web', day: { gte: recentDay(30, now), lte: getSaudiDay(now) } } })
    : [];
  const sum = (since: string) => rows.filter(row => row.day >= since).reduce((total, row) => ({
    visits: total.visits + row.visits, uniqueVisitors: total.uniqueVisitors + row.uniqueVisitors,
  }), { visits: 0, uniqueVisitors: 0 });
  return { today: sum(getSaudiDay(now)), last7Days: sum(recentDay(7, now)), last30Days: sum(recentDay(30, now)) };
}
