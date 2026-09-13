import assert from 'node:assert/strict';
import test from 'node:test';

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
