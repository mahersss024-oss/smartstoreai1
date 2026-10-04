import { getSiteVisitStats } from '@/lib/analytics/site-visits';
import { getRuntimeMetricsSnapshot } from '@/lib/observability/runtime-metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type HealthStatus = 'ok' | 'degraded';

type DatabaseCheck = {
  ok: boolean;
  error?: string;
  errorCode?: string;
  errorMessage?: string;
};

function getDatabaseMode() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE?.trim().toLowerCase() ===
    'database';
}

function shouldIncludeMetrics() {
  return process.env.SMARTSTORE_HEALTH_INCLUDE_METRICS === '1';
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[redacted-database-url]')
    .replace(/(password=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500);
}

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function checkDatabase(): Promise<DatabaseCheck> {
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
      errorCode: getErrorCode(error),
      errorMessage:
        error instanceof Error ? sanitizeErrorMessage(error.message) : undefined,
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
        ...(database.ok
          ? {}
          : {
              databaseError: database.error,
              ...(database.errorCode
                ? { databaseErrorCode: database.errorCode }
                : {}),
              ...(database.errorMessage
                ? { databaseErrorMessage: database.errorMessage }
                : {}),
            }),
      },
      store: getDatabaseMode() ? 'database' : 'file',
      uptimeSeconds: Math.round(process.uptime()),
      responseTimeMs: Date.now() - startedAt,
      ...(shouldIncludeMetrics()
        ? { metrics: getRuntimeMetricsSnapshot() }
        : {}),
    },
    {
      status: database.ok ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
