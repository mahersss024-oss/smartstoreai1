import { ToolLoopAgent } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { appConfig } from '@/app/app-config';
import { searchWeb } from '@/agent/tools/web-search';
import { systemPrompt } from './system-prompt';

function getDeepseekApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error(
      'DEEPSEEK_API_KEY is missing. Add it to your production environment variables.',
    );
  }

  return apiKey;
}

const deepseek = createOpenAI({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: getDeepseekApiKey(),
  fetch: async (input, init) => {
    if (typeof init?.body !== 'string') {
      return fetch(input, init);
    }

    const body = JSON.parse(init.body) as { model?: string };

    return fetch(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        model: appConfig.model,
      }),
    });
  },
});

export const chatAgent = new ToolLoopAgent({
  model: deepseek.chat('gpt-4o'),
  instructions: appConfig.agent.instructions + systemPrompt,
  tools: {
    searchWeb,
  },
});
