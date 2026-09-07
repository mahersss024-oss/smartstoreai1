import { createOpenAI } from '@ai-sdk/openai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { appConfig } from '@/app/app-config';

export type DeepseekModelProfile = 'chat' | 'scope' | 'moderation' | 'vision';

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

export async function fetchDeepseekWithRetry(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  attempts = 3,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);

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
