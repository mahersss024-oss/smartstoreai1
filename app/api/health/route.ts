import { getSiteVisitStats } from '@/lib/analytics/site-visits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type HealthStatus = 'ok' | 'degraded';

function getDatabaseMode() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE?.trim().toLowerCase() ===
    'database';
}

async function checkDatabase(): Promise<{ ok: boolean; error?: string }> {
  if (!getDatabaseMode()) {
    return { ok: true };
  }

  try {
    const { prisma } = await import('@/lib/db/prisma');

    await prisma.$queryRaw`SELECT 1`;

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

export async function GET() {
  const startedAt = Date.now();
  const database = await checkDatabase();
  const status: HealthStatus = database.ok ? 'ok' : 'degraded';

  // Touch the store stats path so a degraded analytics backend does not mask
  // an otherwise healthy process, but never let it fail the health check.
  await getSiteVisitStats().catch(() => undefined);

  return Response.json(
    {
      status,
      checks: {
        database: database.ok ? 'ok' : 'error',
        ...(database.ok ? {} : { databaseError: database.error }),
      },
      store: getDatabaseMode() ? 'database' : 'file',
      uptimeSeconds: Math.round(process.uptime()),
      responseTimeMs: Date.now() - startedAt,
    },
    {
      status: database.ok ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}

