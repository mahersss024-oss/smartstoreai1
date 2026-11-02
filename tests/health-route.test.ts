import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

import { GET } from '@/app/api/health/route';
import {
  incrementRuntimeCounter,
  resetRuntimeMetrics,
} from '@/lib/observability/runtime-metrics';

test('health endpoint reports ok in file store mode by default', async () => {
  const response = await GET();
  const body = (await response.json()) as {
    status: string;
    checks: { database: string };
    store: string;
    uptimeSeconds: number;
  };

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.database, 'ok');
  assert.equal(body.store, 'file');
  assert.ok(Number.isFinite(body.uptimeSeconds));
});

test('health endpoint never caches its response', async () => {
  const response = await GET();

  assert.match(
    response.headers.get('cache-control') ?? '',
    /no-store/,
  );
});

test('database health checks do not query or wait for visitor analytics', async (t) => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  });
  let analyticsCalls = 0;
  let available = true;
  mockDatabaseMethod(t, prisma.siteVisitDaily, 'findUnique', async () => { analyticsCalls++; throw new Error('analytics stalled'); });
  mockDatabaseMethod(t, prisma.siteVisitDaily, 'findMany', async () => { analyticsCalls++; throw new Error('analytics stalled'); });
  mockDatabaseMethod(t, prisma, '$queryRaw', async () => {
    if (!available) throw new Error('database unavailable');
    return [{ '?column?': 1 }];
  });
  const healthy = await GET();
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).checks.database, 'ok');
  assert.equal(analyticsCalls, 0);
  available = false;
  const unavailable = await GET();
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).checks.database, 'error');
  assert.equal(analyticsCalls, 0);
});

test('health endpoint exposes runtime metrics only when explicitly enabled', async () => {
  const previous = process.env.SMARTSTORE_HEALTH_INCLUDE_METRICS;

  resetRuntimeMetrics();
  incrementRuntimeCounter('ai.deepseek.fetch_completed', { status: 200 });

  try {
    delete process.env.SMARTSTORE_HEALTH_INCLUDE_METRICS;
    const defaultResponse = await GET();
    const defaultBody = (await defaultResponse.json()) as { metrics?: unknown };

    assert.equal(defaultBody.metrics, undefined);

    process.env.SMARTSTORE_HEALTH_INCLUDE_METRICS = '1';
    const metricsResponse = await GET();
    const metricsBody = (await metricsResponse.json()) as {
      metrics?: { counters?: Record<string, number> };
    };

    assert.equal(
      metricsBody.metrics?.counters?.[
        'ai.deepseek.fetch_completed{status:200}'
      ],
      1,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SMARTSTORE_HEALTH_INCLUDE_METRICS;
    } else {
      process.env.SMARTSTORE_HEALTH_INCLUDE_METRICS = previous;
    }

    resetRuntimeMetrics();
  }
});
