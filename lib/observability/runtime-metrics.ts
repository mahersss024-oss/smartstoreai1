type RuntimeMetricSummary = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

const counters = new Map<string, number>();
const durationSamples = new Map<string, number[]>();
const maxSamplesPerMetric = 500;

function metricKey(name: string, tags: Record<string, string | number | boolean> = {}) {
  const suffix = Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(',');

  return suffix ? `${name}{${suffix}}` : name;
}

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) {
    return null;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );

  return sorted[index] ?? null;
}

function summarizeSamples(samples: number[]): RuntimeMetricSummary {
  const sorted = [...samples].sort((left, right) => left - right);

  return {
    count: samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? null,
  };
}

export function incrementRuntimeCounter(
  name: string,
  tags?: Record<string, string | number | boolean>,
) {
  const key = metricKey(name, tags);
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function recordRuntimeDurationMs(
  name: string,
  durationMs: number,
  tags?: Record<string, string | number | boolean>,
) {
  const key = metricKey(name, tags);
  const samples = durationSamples.get(key) ?? [];

  samples.push(Math.max(0, Math.round(durationMs)));

  if (samples.length > maxSamplesPerMetric) {
    samples.splice(0, samples.length - maxSamplesPerMetric);
  }

  durationSamples.set(key, samples);
}

export function resetRuntimeMetrics() {
  counters.clear();
  durationSamples.clear();
}

export function getRuntimeMetricsSnapshot() {
  return {
    counters: Object.fromEntries([...counters.entries()].sort()),
    durations: Object.fromEntries(
      [...durationSamples.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, samples]) => [key, summarizeSamples(samples)]),
    ),
  };
}
