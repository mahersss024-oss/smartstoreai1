import { createOpenAI } from '@ai-sdk/openai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { appConfig } from '@/app/app-config';
import {
  incrementRuntimeCounter,
  recordRuntimeDurationMs,
} from '@/lib/observability/runtime-metrics';

export type DeepseekModelProfile =
  | 'chat'
  | 'scope'
  | 'search'
  | 'moderation'
  | 'vision';

const defaultDeepseekMaxConcurrentRequests = 100;
const defaultDeepseekMaxQueuedRequests = 2_000;
const defaultDeepseekQueueTimeoutMs = 60_000;
const deepseekSlotQueue: Array<() => void> = [];
let activeDeepseekRequests = 0;

export type DeepseekProviderMetrics = {
  attempts: number;
  completed: number;
  fetchErrors: number;
  transientResponses: number;
  maxActiveRequests: number;
  statusCounts: Record<string, number>;
  queueWaitMs: number[];
  providerFetchMs: number[];
};

const deepseekProviderMetrics: DeepseekProviderMetrics = {
  attempts: 0,
  completed: 0,
  fetchErrors: 0,
  transientResponses: 0,
  maxActiveRequests: 0,
  statusCounts: {},
  queueWaitMs: [],
  providerFetchMs: [],
};

const profileEnvironmentKeys = {
  chat: 'DEEPSEEK_CHAT_MODEL',
  scope: 'DEEPSEEK_SCOPE_MODEL',
  search: 'DEEPSEEK_SEARCH_MODEL',
  moderation: 'DEEPSEEK_MODERATION_MODEL',
  vision: 'DEEPSEEK_VISION_MODEL',
} satisfies Record<DeepseekModelProfile, string>;

function readLocalEnvValue(key: string) {
  let content = '';

  try {
    content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  } catch {
    return undefined;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const envKey = trimmed.slice(0, separatorIndex).trim();

    if (envKey !== key) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    return value;
  }

  return undefined;
}

function shouldPreferLocalEnvFile() {
  return !process.env.RENDER && !process.env.VERCEL && !process.env.CI;
}

export function getDeepseekApiKey() {
  const localKey = shouldPreferLocalEnvFile()
    ? readLocalEnvValue('DEEPSEEK_API_KEY')?.trim()
    : undefined;

  return localKey || process.env.DEEPSEEK_API_KEY?.trim() || '';
}

export function normalizeDeepseekChatBody(body: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return body;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('messages' in parsed) ||
    !Array.isArray(parsed.messages)
  ) {
    return body;
  }

  return JSON.stringify({
    thinking:
      'thinking' in parsed ? parsed.thinking : { type: 'disabled' },
    ...parsed,
    messages: parsed.messages.map((message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        message.role === 'developer'
      ) {
        return {
          ...message,
          role: 'system',
        };
      }

      return message;
    }),
  });
}

export function isTransientDeepseekResponse(status: number) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Request aborted.', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Request aborted.', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function shouldCollectDeepseekProviderMetrics() {
  return process.env.SMARTSTORE_DEEPSEEK_METRICS === '1';
}

function recordMetricSample(target: number[], value: number) {
  if (shouldCollectDeepseekProviderMetrics()) {
    target.push(Math.round(value));
  }
}

function recordStatusMetric(status: number) {
  if (!shouldCollectDeepseekProviderMetrics()) {
    return;
  }

  const key = String(status);
  deepseekProviderMetrics.statusCounts[key] =
    (deepseekProviderMetrics.statusCounts[key] ?? 0) + 1;

  if (isTransientDeepseekResponse(status)) {
    deepseekProviderMetrics.transientResponses += 1;
  }
}

export function resetDeepseekProviderMetrics() {
  deepseekProviderMetrics.attempts = 0;
  deepseekProviderMetrics.completed = 0;
  deepseekProviderMetrics.fetchErrors = 0;
  deepseekProviderMetrics.transientResponses = 0;
  deepseekProviderMetrics.maxActiveRequests = 0;
  deepseekProviderMetrics.statusCounts = {};
  deepseekProviderMetrics.queueWaitMs = [];
  deepseekProviderMetrics.providerFetchMs = [];
}

export function getDeepseekProviderMetrics() {
  return {
    ...deepseekProviderMetrics,
    statusCounts: { ...deepseekProviderMetrics.statusCounts },
    queueWaitMs: [...deepseekProviderMetrics.queueWaitMs],
    providerFetchMs: [...deepseekProviderMetrics.providerFetchMs],
  } satisfies DeepseekProviderMetrics;
}

export function getDeepseekMaxConcurrentRequests() {
  const configuredValue = Number.parseInt(
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS ?? '',
    10,
  );

  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return defaultDeepseekMaxConcurrentRequests;
  }

  return Math.min(512, Math.max(1, configuredValue));
}

export function getDeepseekMaxQueuedRequests() {
  const configuredValue = Number.parseInt(
    process.env.SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS ?? '',
    10,
  );

  if (!Number.isFinite(configuredValue) || configuredValue < 0) {
    return defaultDeepseekMaxQueuedRequests;
  }

  return Math.min(10_000, configuredValue);
}

export function getDeepseekQueueTimeoutMs() {
  const configuredValue = Number.parseInt(
    process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS ?? '',
    10,
  );

  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return defaultDeepseekQueueTimeoutMs;
  }

  return Math.min(60_000, Math.max(1_000, configuredValue));
}

function removeQueuedSlot(waiter: () => void) {
  const index = deepseekSlotQueue.indexOf(waiter);

  if (index >= 0) {
    deepseekSlotQueue.splice(index, 1);
  }
}

function releaseDeepseekSlot() {
  activeDeepseekRequests = Math.max(0, activeDeepseekRequests - 1);

  queueMicrotask(() => {
    const maxConcurrentRequests = getDeepseekMaxConcurrentRequests();

    while (
      activeDeepseekRequests < maxConcurrentRequests &&
      deepseekSlotQueue.length > 0
    ) {
      const next = deepseekSlotQueue.shift();

      if (next) {
        next();
      }
    }
  });
}

function acquireDeepseekSlot(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw new DOMException('DeepSeek request aborted.', 'AbortError');
  }

  if (activeDeepseekRequests < getDeepseekMaxConcurrentRequests()) {
    activeDeepseekRequests += 1;
    deepseekProviderMetrics.maxActiveRequests = Math.max(
      deepseekProviderMetrics.maxActiveRequests,
      activeDeepseekRequests,
    );
    return Promise.resolve(releaseDeepseekSlot);
  }

  if (deepseekSlotQueue.length >= getDeepseekMaxQueuedRequests()) {
    incrementRuntimeCounter('ai.deepseek.queue_rejected');
    throw new DOMException('DeepSeek request queue is full.', 'AbortError');
  }

  return new Promise<() => void>((resolve, reject) => {
    const onAbort = () => {
      removeQueuedSlot(waiter);
      clearTimeout(timeout);
      reject(new DOMException('DeepSeek request aborted.', 'AbortError'));
    };
    const waiter = () => {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      activeDeepseekRequests += 1;
      deepseekProviderMetrics.maxActiveRequests = Math.max(
        deepseekProviderMetrics.maxActiveRequests,
        activeDeepseekRequests,
      );
      resolve(releaseDeepseekSlot);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      removeQueuedSlot(waiter);
      incrementRuntimeCounter('ai.deepseek.queue_timeout');
      reject(new DOMException('DeepSeek request queue timed out.', 'AbortError'));
    }, getDeepseekQueueTimeoutMs());

    signal?.addEventListener('abort', onAbort, { once: true });
    deepseekSlotQueue.push(waiter);
  });
}

function retainSlotForResponseBody(
  response: Response,
  release: () => void,
  signal?: AbortSignal | null,
) {
  if (!response.body) {
    release();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  let released = false;
  let bodyController: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    if (released) return;
    released = true;
    signal?.removeEventListener('abort', onAbort);
    release();
  };
  const cancelUpstream = (reason?: unknown) => {
    // Cancellation is requested synchronously, but a broken upstream may never
    // acknowledge it. Neither the consumer nor the retry loop waits for that
    // acknowledgement. Observe rejection and release the reader when it settles.
    void reader.cancel(reason).finally(() => reader.releaseLock()).catch(() => undefined);
  };
  const onAbort = () => {
    if (finished) return;
    finished = true;
    const reason = signal?.reason ?? new DOMException('Request aborted.', 'AbortError');
    bodyController.error(reason);
    finish();
    cancelUpstream(reason);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller;
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) {
          finished = true;
          controller.close();
          finish();
          reader.releaseLock();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!finished) {
          finished = true;
          controller.error(error);
        }
        finish();
      }
    },
    cancel(reason) {
      finished = true;
      // Release even when a broken upstream implementation cannot acknowledge
      // cancellation; a later close/abort must not release another request's slot.
      finish();
      cancelUpstream(reason);
    },
  }, { highWaterMark: 0 });
  // Observe upstream errors even if the caller has not started reading yet.
  // A clean upstream close releases the connection without discarding the final
  // chunk that may still be returning from an in-flight reader.read().
  void reader.closed.then(finish, (error) => {
    if (!finished) {
      finished = true;
      bodyController.error(error);
    }
    finish();
  });
  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const key of ['url', 'redirected', 'type'] as const) {
    Object.defineProperty(wrapped, key, { value: response[key] });
  }
  return wrapped;
}

async function fetchDeepseekWithConcurrencyLimit(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) {
  const queueStartedAt = Date.now();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const release = await acquireDeepseekSlot(signal);
  let responseOwnsSlot = false;
  recordMetricSample(
    deepseekProviderMetrics.queueWaitMs,
    Date.now() - queueStartedAt,
  );
  recordRuntimeDurationMs(
    'ai.deepseek.queue_wait_ms',
    Date.now() - queueStartedAt,
  );

  try {
    const fetchStartedAt = Date.now();

    try {
      deepseekProviderMetrics.attempts += 1;
      incrementRuntimeCounter('ai.deepseek.fetch_attempt');
      const response = await fetch(input, init);
      deepseekProviderMetrics.completed += 1;
      incrementRuntimeCounter('ai.deepseek.fetch_completed', {
        status: response.status,
      });
      recordStatusMetric(response.status);
      recordMetricSample(
        deepseekProviderMetrics.providerFetchMs,
        Date.now() - fetchStartedAt,
      );
      recordRuntimeDurationMs(
        'ai.deepseek.provider_fetch_ms',
        Date.now() - fetchStartedAt,
        { status: response.status },
      );

      const retainedResponse = retainSlotForResponseBody(response, release, signal);
      responseOwnsSlot = true;
      return retainedResponse;
    } catch (error) {
      deepseekProviderMetrics.fetchErrors += 1;
      incrementRuntimeCounter('ai.deepseek.fetch_error');
      recordMetricSample(
        deepseekProviderMetrics.providerFetchMs,
        Date.now() - fetchStartedAt,
      );
      recordRuntimeDurationMs(
        'ai.deepseek.provider_fetch_ms',
        Date.now() - fetchStartedAt,
        { status: 'error' },
      );
      throw error;
    }
  } finally {
    if (!responseOwnsSlot) release();
  }
}

export async function fetchDeepseekWithRetry(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  attempts = 3,
) {
  let lastError: unknown;
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchDeepseekWithConcurrencyLimit(input, init);

      if (
        !isTransientDeepseekResponse(response.status) ||
        attempt === attempts - 1
      ) {
        return response;
      }

      // These bytes will never be consumed by the SDK. Stop the old response
      // before obtaining another permit for a retry.
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (signal?.aborted || isAbortError(error) || attempt === attempts - 1) {
        throw error;
      }

      lastError = error;
    }

    await wait(250 * (attempt + 1), signal);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('DeepSeek request failed.');
}

export const deepseek = createOpenAI({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: getDeepseekApiKey(),
  fetch: async (input, init) => {
    if (typeof init?.body !== 'string') {
      return fetchDeepseekWithRetry(input, init);
    }

    return fetchDeepseekWithRetry(input, {
      ...init,
      body: normalizeDeepseekChatBody(init.body),
    });
  },
});

export function getDeepseekModelName(profile: DeepseekModelProfile = 'chat') {
  return (
    process.env[profileEnvironmentKeys[profile]]?.trim() ||
    process.env.DEEPSEEK_MODEL?.trim() ||
    appConfig.models[profile]
  );
}

export function getDeepseekChatModel(profile: DeepseekModelProfile = 'chat') {
  return deepseek.chat(getDeepseekModelName(profile));
}
