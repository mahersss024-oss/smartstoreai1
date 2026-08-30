import { ToolLoopAgent } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { appConfig } from '@/app/app-config';
import { searchWeb } from '@/agent/tools/web-search';
import { systemPrompt } from './system-prompt';

function normalizeDeepseekChatBody(body: string) {
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

const deepseek = createOpenAI({
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

export const chatAgent = new ToolLoopAgent({
  model: deepseek.chat(appConfig.model),
  instructions: appConfig.agent.instructions + systemPrompt,
  tools: {
    searchWeb,
  },
});
