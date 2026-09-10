import { createOpenAI } from '@ai-sdk/openai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { appConfig } from '@/app/app-config';

export type DeepseekModelProfile = 'chat' | 'scope' | 'moderation' | 'vision';

const defaultDeepseekMaxConcurrentRequests = 64;
const defaultDeepseekQueueTimeoutMs = 15_000;
const deepseekSlotQueue: Array<() => void> = [];
let activeDeepseekRequests = 0;

const profileEnvironmentKeys = {
  chat: 'DEEPSEEK_CHAT_MODEL',
  scope: 'DEEPSEEK_SCOPE_MODEL',
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return Promise.resolve(releaseDeepseekSlot);
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
      resolve(releaseDeepseekSlot);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      removeQueuedSlot(waiter);
      reject(new DOMException('DeepSeek request queue timed out.', 'AbortError'));
    }, getDeepseekQueueTimeoutMs());

    signal?.addEventListener('abort', onAbort, { once: true });
    deepseekSlotQueue.push(waiter);
  });
}

async function fetchDeepseekWithConcurrencyLimit(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) {
  const release = await acquireDeepseekSlot(init?.signal);

  try {
    return await fetch(input, init);
  } finally {
    release();
  }
}

export async function fetchDeepseekWithRetry(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  attempts = 3,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchDeepseekWithConcurrencyLimit(input, init);

      if (
        !isTransientDeepseekResponse(response.status) ||
        attempt === attempts - 1
      ) {
        return response;
      }
    } catch (error) {
      if (isAbortError(error) || attempt === attempts - 1) {
        throw error;
      }

      lastError = error;
    }

    await wait(250 * (attempt + 1));
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
