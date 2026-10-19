import { performance } from 'node:perf_hooks';
import { parseJsonEventStream, uiMessageChunkSchema } from 'ai';

import { createSessionCookie } from '../lib/auth/session';
import { chatServiceUnavailableMessage } from '../lib/chat-response-safety';
import { createPlatformHelpCompletion } from './testing/platform-help-model-fixture.mjs';

type DeepseekProviderModule = typeof import('../agent/deepseek-provider');

type LoadResult = {
  level: number;
  total: number;
  ok: number;
  failed: number;
  httpErrors: number;
  emptyBodies: number;
  incompleteStreams: number;
  providerFallbackResponses: number;
  providerCalls: number;
  providerRejectedCalls: number;
  maxProviderInFlight: number;
  providerStatusCounts: Record<string, number>;
  queueWaitP50Ms: number;
  queueWaitP95Ms: number;
  queueWaitMaxMs: number;
  providerFetchP50Ms: number;
  providerFetchP95Ms: number;
  providerFetchMaxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
};

type RequestResult = {
  ok: boolean;
  status: number;
  durationMs: number;
  body: string;
  completedStream: boolean;
  error?: string;
};

const levels = (process.env.AI_LOAD_LEVELS ?? '50,100,200,300,400,500')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const requestTimeoutMs = Number.parseInt(
  process.env.AI_LOAD_REQUEST_TIMEOUT_MS ?? '30000',
  10,
);
const providerLatencyMs = Number.parseInt(
  process.env.AI_LOAD_PROVIDER_LATENCY_MS ?? '40',
  10,
);
const providerMaxInFlight = Number.parseInt(
  process.env.AI_LOAD_PROVIDER_MAX_IN_FLIGHT ?? '0',
  10,
);
const providerStatus = Number.parseInt(process.env.AI_LOAD_PROVIDER_STATUS ?? '200', 10);
const mode = process.env.AI_LOAD_MODE ?? 'mock';
const realFetch = globalThis.fetch.bind(globalThis);
const originalConsoleLog = console.log.bind(console);
let providerCalls = 0;
let providerInFlight = 0;
let providerRejectedCalls = 0;
let maxProviderInFlight = 0;
let deepseekProviderModule: DeepseekProviderModule | null = null;
const scopeFallbackReplies = new Set<string>();

process.env.SMARTSTORE_MARKETPLACE_STORE ||= 'memory';
process.env.SMARTSTORE_DEEPSEEK_METRICS = '1';

if (mode === 'mock') {
  process.env.DEEPSEEK_API_KEY ||= 'load-test-key';
}

if (process.env.AI_LOAD_VERBOSE !== '1') {
  console.log = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';

    if (first.startsWith('{')) {
      originalConsoleLog(...args);
    }
  };
  console.info = () => {};
  console.warn = () => {};
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDeepseekProviderModule() {
  deepseekProviderModule ??= await import('../agent/deepseek-provider');

  return deepseekProviderModule;
}

function installMockProvider() {
  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (url.includes('api.deepseek.com')) {
      providerCalls += 1;
      providerInFlight += 1;
      maxProviderInFlight = Math.max(maxProviderInFlight, providerInFlight);

      try {
        if (providerStatus !== 200) {
          return Response.json({ error: { message: 'mock provider unavailable' } }, { status: providerStatus });
        }
        if (
          providerMaxInFlight > 0 &&
          providerInFlight > providerMaxInFlight
        ) {
          providerRejectedCalls += 1;

          return Response.json(
            {
              error: {
                message: 'mock provider concurrency limit exceeded',
                type: 'rate_limit_error',
              },
            },
            { status: 429 },
          );
        }

        if (providerLatencyMs > 0) {
          await wait(providerLatencyMs);
        }

        const body = typeof init?.body === 'string' ? init.body : '';
        return createPlatformHelpCompletion(body, `chatcmpl-load-${providerCalls}`);
      } finally {
        providerInFlight -= 1;
      }
    }

    return realFetch(input, init);
  };
}

function buildRequest(index: number, signal: AbortSignal) {
  const cookie = createSessionCookie({
    id: `load-user-${index}`,
    email: `load-user-${index}@example.test`,
    name: `Load User ${index}`,
  });

  return new Request('http://localhost/api/chat', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-forwarded-for': `10.${Math.floor(index / 65536) % 255}.${Math.floor(index / 256) % 255}.${index % 255}`,
    },
    body: JSON.stringify({
      messages: [
        {
          id: `msg-${index}`,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'كيف أنشئ إعلانًا وأراجع مسودته في المنصة؟',
            },
          ],
        },
      ],
      locationSettings: {
        country: 'SA',
        currency: 'SAR',
        language: 'ar',
      },
    }),
  });
}

async function runOne(index: number): Promise<RequestResult> {
  const { POST } = await import('../app/api/chat/route');
  const start = performance.now();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const requestPromise = (async () => {
      const response = await POST(buildRequest(index, controller.signal));
      if (!response.ok || !response.body) return { response, body: await response.text(), completedStream: false };
      const reader = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema }).getReader();
      let body = '';
      let completedStream = false;
      let invalidStream = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!chunk.value.success) {
          invalidStream = true;
          continue;
        }
        const event = chunk.value.value;
        if (event.type === 'text-delta') body += event.delta;
        if (event.type === 'finish') completedStream = true;
        if (event.type === 'error' || event.type === 'abort') invalidStream = true;
      }
      return { response, body, completedStream: completedStream && !invalidStream };
    })();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new DOMException('AI load request exceeded its deadline', 'TimeoutError'));
      }, requestTimeoutMs);
    });
    const { response, body, completedStream } = await Promise.race([requestPromise, timeoutPromise]);
    if (performance.now() - start > requestTimeoutMs) {
      controller.abort();
      throw new DOMException('AI load response exceeded its elapsed-time deadline', 'TimeoutError');
    }

    return {
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - start,
      body,
      completedStream,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - start,
      body: '',
      completedStream: false,
      error: error instanceof Error ? error.name : 'UnknownError',
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * ratio) - 1),
  );

  return values[index];
}

function summarize(
  level: number,
  results: RequestResult[],
  providerMetrics: ReturnType<DeepseekProviderModule['getDeepseekProviderMetrics']>,
): LoadResult {
  const durations = results
    .map((result) => result.durationMs)
    .sort((left, right) => left - right);
  const queueWaitDurations = providerMetrics.queueWaitMs.sort(
    (left, right) => left - right,
  );
  const providerFetchDurations = providerMetrics.providerFetchMs.sort(
    (left, right) => left - right,
  );
  const isIncompleteSuccessfulResponse = (result: RequestResult) => {
    if (!result.ok || !result.body.trim()) {
      return false;
    }

    return !result.completedStream;
  };
  const bodyFailures = results.filter(isIncompleteSuccessfulResponse).length;
  const emptyBodies = results.filter(
    (result) => result.ok && !result.body.trim(),
  ).length;
  const isProviderFallback = (result: RequestResult) => scopeFallbackReplies.has(result.body) || result.body === chatServiceUnavailableMessage ||
    result.body.startsWith('تعذر إكمال رد حمد الآن.') || result.body.startsWith('حُفظت مسودة إعلانك، لكن تعذر إكمال رد المساعد.');
  const providerFallbackResponses = results.filter(isProviderFallback).length;
  const ok = results.filter(
    (result) =>
      result.ok &&
      result.body.trim() &&
      !isIncompleteSuccessfulResponse(result) &&
      !isProviderFallback(result),
  ).length;
  const avgMs =
    durations.reduce((total, duration) => total + duration, 0) /
    Math.max(1, durations.length);

  return {
    level,
    total: results.length,
    ok,
    failed: results.length - ok,
    httpErrors: results.filter((result) => !result.ok).length,
    emptyBodies,
    incompleteStreams: bodyFailures,
    providerFallbackResponses,
    providerCalls: providerMetrics.attempts || providerCalls,
    providerRejectedCalls:
      Number(providerMetrics.statusCounts['429'] ?? providerRejectedCalls),
    maxProviderInFlight:
      providerMetrics.maxActiveRequests || maxProviderInFlight,
    providerStatusCounts: providerMetrics.statusCounts,
    queueWaitP50Ms: Math.round(percentile(queueWaitDurations, 0.5)),
    queueWaitP95Ms: Math.round(percentile(queueWaitDurations, 0.95)),
    queueWaitMaxMs: Math.round(queueWaitDurations.at(-1) ?? 0),
    providerFetchP50Ms: Math.round(percentile(providerFetchDurations, 0.5)),
    providerFetchP95Ms: Math.round(percentile(providerFetchDurations, 0.95)),
    providerFetchMaxMs: Math.round(providerFetchDurations.at(-1) ?? 0),
    minMs: Math.round(durations[0] ?? 0),
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
    maxMs: Math.round(durations.at(-1) ?? 0),
    avgMs: Math.round(avgMs),
  };
}

async function runLevel(level: number) {
  const providerModule = await getDeepseekProviderModule();

  providerModule.resetDeepseekProviderMetrics();
  providerCalls = 0;
  providerInFlight = 0;
  providerRejectedCalls = 0;
  maxProviderInFlight = 0;
  const results = await Promise.all(
    Array.from({ length: level }, (_, index) => runOne(index + level * 10_000)),
  );
  return summarize(level, results, providerModule.getDeepseekProviderMetrics());
}

async function main() {
  if (mode !== 'mock' && mode !== 'real') {
    throw new Error('Use AI_LOAD_MODE=mock or AI_LOAD_MODE=real.');
  }
  if (!levels.length) {
    throw new Error('AI_LOAD_LEVELS must contain at least one positive concurrency level.');
  }

  if (mode === 'mock') {
    installMockProvider();
  } else if (!(await getDeepseekProviderModule()).getDeepseekApiKey()) {
    throw new Error('DEEPSEEK_API_KEY is required for AI_LOAD_MODE=real.');
  }
  const { getSafeScopeResponse } = await import('../agent/scope-guard');
  scopeFallbackReplies.add(getSafeScopeResponse('BLOCK', 'ar'));
  scopeFallbackReplies.add(getSafeScopeResponse('UNCLEAR', 'ar'));

  const summaries: LoadResult[] = [];

  for (const level of levels) {
    const summary = await runLevel(level);
    summaries.push(summary);
    console.log(JSON.stringify(summary));
    if (summary.failed > 0 || summary.providerCalls === 0) break;
  }

  console.log(JSON.stringify({ summaries }, null, 2));
  if (summaries.some(summary => summary.failed > 0 || summary.providerCalls === 0)) {
    console.error('AI load checks failed: every level must complete real route/provider work without failed responses.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
