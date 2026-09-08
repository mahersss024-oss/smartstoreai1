#!/usr/bin/env node

const defaultBaseUrl = 'https://www.smartstore-ai.com';
const defaultStages = [5, 10, 20, 50, 100];
const chatPath = '/api/chat';

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStages(value) {
  if (!value) {
    return defaultStages;
  }

  const stages = value
    .split(',')
    .map((stage) => Number.parseInt(stage.trim(), 10))
    .filter((stage) => Number.isFinite(stage) && stage > 0);

  return stages.length ? stages : defaultStages;
}

function parseArgs() {
  const args = new Map();

  for (const arg of process.argv.slice(2)) {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    args.set(key, value);
  }

  return {
    baseUrl: args.get('url') ?? defaultBaseUrl,
    message: args.get('message') ?? 'search for Toyota Camry in Tabuk',
    stages: parseStages(args.get('stages')),
    timeoutMs: parseNumber(args.get('timeout'), 90) * 1000,
    stopErrorRate: parseNumber(args.get('stop-error-rate'), 20),
    stopP95Ms: parseNumber(args.get('stop-p95-ms'), 45_000),
  };
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

function createBody(message) {
  return JSON.stringify({
    messages: [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: message,
          },
        ],
      },
    ],
    locationSettings: {
      language: 'en',
    },
  });
}

function createClientIp(index) {
  return `198.51.100.${(index % 250) + 1}`;
}

async function requestChatOnce({ baseUrl, body, timeoutMs, index }) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${chatPath}`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream,text/plain,*/*',
        'Content-Type': 'application/json',
        'User-Agent': 'SmartStoreAI-chat-load-check/1.0',
        'X-Forwarded-For': createClientIp(index),
      },
      body,
      signal: controller.signal,
    });
    const responseBytes = (await response.arrayBuffer()).byteLength;

    return {
      ok: response.ok,
      status: response.status,
      timeMs: performance.now() - startedAt,
      bytes: responseBytes,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.name : 'unknown_error',
      ok: false,
      status: 0,
      timeMs: performance.now() - startedAt,
      bytes: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runStage(concurrency, options) {
  const body = createBody(options.message);
  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      requestChatOnce({
        baseUrl: options.baseUrl,
        body,
        timeoutMs: options.timeoutMs,
        index,
      }),
    ),
  );
  const latencies = results.map((result) => result.timeMs).sort((a, b) => a - b);
  const failures = results.filter((result) => !result.ok);
  const statusCounts = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  const totalBytes = results.reduce((total, result) => total + result.bytes, 0);
  const errorRate = results.length ? (failures.length / results.length) * 100 : 0;
  const averageMs =
    latencies.reduce((total, value) => total + value, 0) /
    Math.max(latencies.length, 1);

  return {
    avgMs: round(averageMs),
    concurrency,
    errorRate: `${round(errorRate)}%`,
    failed: failures.length,
    p95Ms: round(percentile(latencies, 95)),
    p99Ms: round(percentile(latencies, 99)),
    requests: results.length,
    statuses: JSON.stringify(statusCounts),
    totalKb: round(totalBytes / 1024),
    stop:
      errorRate >= options.stopErrorRate ||
      percentile(latencies, 95) >= options.stopP95Ms,
  };
}

async function main() {
  const options = parseArgs();
  const summary = [];

  console.log(`Chat load test: ${options.baseUrl}${chatPath}`);
  console.log(`Stages: ${options.stages.join(', ')}`);
  console.log('Profile: real AI chat requests, no images, no writes');

  for (const concurrency of options.stages) {
    console.log(`\nStage ${concurrency} concurrent chat users...`);
    const result = await runStage(concurrency, options);
    summary.push(result);
    console.table([result]);

    if (result.stop) {
      console.log(
        `Stopping early at ${concurrency}: error/p95 threshold reached.`,
      );
      break;
    }
  }

  console.log('\nSummary');
  console.table(summary);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
