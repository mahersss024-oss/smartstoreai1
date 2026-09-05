import { createOpenAI } from '@ai-sdk/openai';

import { appConfig } from '@/app/app-config';

export type DeepseekModelProfile = 'chat' | 'scope' | 'moderation' | 'vision';

const profileEnvironmentKeys = {
  chat: 'DEEPSEEK_CHAT_MODEL',
  scope: 'DEEPSEEK_SCOPE_MODEL',
  moderation: 'DEEPSEEK_MODERATION_MODEL',
  vision: 'DEEPSEEK_VISION_MODEL',
} satisfies Record<DeepseekModelProfile, string>;

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

export const deepseek = createOpenAI({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  fetch: async (input, init) => {
    if (typeof init?.body !== 'string') {
      return fetch(input, init);
    }

    return fetch(input, {
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
