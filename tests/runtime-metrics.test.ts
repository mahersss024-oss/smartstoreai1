import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRuntimeMetricsSnapshot,
  incrementRuntimeCounter,
  recordRuntimeDurationMs,
  resetRuntimeMetrics,
} from '@/lib/observability/runtime-metrics';

test('runtime metrics aggregate counters and duration percentiles', () => {
  resetRuntimeMetrics();

  incrementRuntimeCounter('ai.deepseek.fetch_completed', { status: 200 });
  incrementRuntimeCounter('ai.deepseek.fetch_completed', { status: 200 });
  recordRuntimeDurationMs('ai.deepseek.provider_fetch_ms', 25, { status: 200 });
  recordRuntimeDurationMs('ai.deepseek.provider_fetch_ms', 75, { status: 200 });

  const snapshot = getRuntimeMetricsSnapshot();

  assert.equal(
    snapshot.counters['ai.deepseek.fetch_completed{status:200}'],
    2,
  );
  assert.deepEqual(
    snapshot.durations['ai.deepseek.provider_fetch_ms{status:200}'],
    {
      count: 2,
      p50: 25,
      p95: 75,
      max: 75,
    },
  );
});
