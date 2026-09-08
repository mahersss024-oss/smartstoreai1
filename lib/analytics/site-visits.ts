import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

export const siteVisitorCookieName = 'smartstore_visitor_id';

function shouldUseDatabaseAnalytics() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

export function getSaudiDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
  }).format(now);
}

function getRecentSaudiDays(count: number, now = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - index);

    return getSaudiDay(date);
  });
}

export async function recordSiteVisit(input: {
  visitorId: string;
  path?: string;
}) {
  if (!shouldUseDatabaseAnalytics()) {
    return;
  }

  const day = getSaudiDay();

  await prisma.siteVisitDaily.upsert({
    where: { day },
    create: {
      day,
      visits: 1,
      uniqueVisitors: 0,
    },
    update: {
      visits: { increment: 1 },
    },
  });

  try {
    await prisma.siteVisitUnique.create({
      data: {
        day,
        visitorId: input.visitorId,
      },
    });
    await prisma.siteVisitDaily.update({
      where: { day },
      data: {
        uniqueVisitors: { increment: 1 },
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return;
    }

    throw error;
  }
}

export async function getSiteVisitStats() {
  if (!shouldUseDatabaseAnalytics()) {
    return {
      today: { visits: 0, uniqueVisitors: 0 },
      last7Days: { visits: 0, uniqueVisitors: 0 },
      last30Days: { visits: 0, uniqueVisitors: 0 },
    };
  }

  const today = getSaudiDay();
  const last7Days = getRecentSaudiDays(7);
  const last30Days = getRecentSaudiDays(30);
  const [todayRecord, last7Records, last30Records] = await Promise.all([
    prisma.siteVisitDaily.findUnique({ where: { day: today } }),
    prisma.siteVisitDaily.findMany({ where: { day: { in: last7Days } } }),
    prisma.siteVisitDaily.findMany({ where: { day: { in: last30Days } } }),
  ]);

  function sum(records: Array<{ visits: number; uniqueVisitors: number }>) {
    return records.reduce(
      (total, record) => ({
        visits: total.visits + record.visits,
        uniqueVisitors: total.uniqueVisitors + record.uniqueVisitors,
      }),
      { visits: 0, uniqueVisitors: 0 },
    );
  }

  return {
    today: {
      visits: todayRecord?.visits ?? 0,
      uniqueVisitors: todayRecord?.uniqueVisitors ?? 0,
    },
    last7Days: sum(last7Records),
    last30Days: sum(last30Records),
  };
}
