#!/usr/bin/env node

const defaultBaseUrl = 'https://www.smartstore-ai.com';
const stages = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
const browsePaths = [
  '/api/marketplace/listings?limit=24&page=1',
  '/api/marketplace/listings?limit=24&page=2',
  '/api/marketplace/listings?limit=24&page=3',
  '/api/marketplace/listings?limit=24&page=4',
  '/api/marketplace/listings?limit=24&page=5',
  '/',
];

function parseArgs() {
  const args = new Map();

  for (const arg of process.argv.slice(2)) {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    args.set(key, value);
  }

  return {
    baseUrl: args.get('url') ?? defaultBaseUrl,
    durationMs: Number(args.get('duration') ?? 8) * 1000,
    timeoutMs: Number(args.get('timeout') ?? 12) * 1000,
    minThinkMs: Number(args.get('min-think') ?? 250),
    maxThinkMs: Number(args.get('max-think') ?? 750),
    stopErrorRate: Number(args.get('stop-error-rate') ?? 15),
    stopP95Ms: Number(args.get('stop-p95-ms') ?? 10_000),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, percent) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.ceil((percent / 100) * values.length) - 1,
  );

  return values[index];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pickPath(workerId, iteration) {
  return browsePaths[(workerId + iteration) % browsePaths.length];
}

function createClientIp(workerId) {
  return `203.0.${Math.floor(workerId / 250) % 250}.${(workerId % 250) + 1}`;
}

async function requestOnce(baseUrl, path, timeoutMs, workerId) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        'User-Agent': 'SmartStoreAI-load-check/1.0',
        'X-Forwarded-For': createClientIp(workerId),
      },
      signal: controller.signal,
    });

    await response.arrayBuffer();

    return {
      cache: response.headers.get('x-smartstore-cache') ?? '',
      ok: response.ok,
      status: response.status,
      timeMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      cache: '',
      error: error instanceof Error ? error.name : 'unknown_error',
      ok: false,
      status: 0,
      timeMs: performance.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runStage(concurrency, options) {
  const endAt = Date.now() + options.durationMs;
  const results = [];

  await Promise.all(
    Array.from({ length: concurrency }, async (_, workerId) => {
      let iteration = 0;

      while (Date.now() < endAt) {
        results.push(
          await requestOnce(
            options.baseUrl,
            pickPath(workerId, iteration),
            options.timeoutMs,
            workerId,
          ),
        );
        iteration += 1;
        await sleep(randomBetween(options.minThinkMs, options.maxThinkMs));
      }
    }),
  );

  const latencies = results.map((result) => result.timeMs).sort((a, b) => a - b);
  const failures = results.filter((result) => !result.ok);
  const cacheHits = results.filter((result) => result.cache === 'HIT').length;
  const statusCounts = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  const requestsPerSecond = results.length / (options.durationMs / 1000);
  const errorRate = results.length ? (failures.length / results.length) * 100 : 0;
  const averageMs =
    latencies.reduce((total, value) => total + value, 0) / Math.max(latencies.length, 1);

  return {
    avgMs: round(averageMs),
    cacheHitRate: `${round((cacheHits / Math.max(results.length, 1)) * 100)}%`,
    concurrency,
    errorRate: `${round(errorRate)}%`,
    failed: failures.length,
    p95Ms: round(percentile(latencies, 95)),
    p99Ms: round(percentile(latencies, 99)),
    requests: results.length,
    rps: round(requestsPerSecond),
    statusCounts,
    stop:
      errorRate >= options.stopErrorRate ||
      percentile(latencies, 95) >= options.stopP95Ms,
  };
}

async function main() {
  const options = parseArgs();
  const summary = [];

  console.log(
    `Load test: ${options.baseUrl} duration=${options.durationMs / 1000}s per stage`,
  );
  console.log('Profile: read-only browse, no AI chat, no uploads, no writes');

  for (const concurrency of stages) {
    console.log(`\nStage ${concurrency} concurrent users...`);
    const result = await runStage(concurrency, options);
    summary.push(result);
    console.table([
      {
        users: result.concurrency,
        requests: result.requests,
        rps: result.rps,
        avgMs: result.avgMs,
        p95Ms: result.p95Ms,
        p99Ms: result.p99Ms,
        failed: result.failed,
        errorRate: result.errorRate,
        cacheHitRate: result.cacheHitRate,
        statuses: JSON.stringify(result.statusCounts),
      },
    ]);

    if (result.stop) {
      console.log(
        `Stopping early at ${concurrency}: error/p95 threshold reached.`,
      );
      break;
    }
  }

  console.log('\nSummary');
  console.table(
    summary.map((result) => ({
      users: result.concurrency,
      requests: result.requests,
      rps: result.rps,
      avgMs: result.avgMs,
      p95Ms: result.p95Ms,
      p99Ms: result.p99Ms,
      failed: result.failed,
      errorRate: result.errorRate,
      cacheHitRate: result.cacheHitRate,
    })),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
