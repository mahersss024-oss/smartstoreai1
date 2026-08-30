import { ToolLoopAgent } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { appConfig } from '@/app/app-config';
import { searchWeb } from '@/agent/tools/web-search';
import { systemPrompt } from './system-prompt';

const deepseek = createOpenAI({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
});

export const chatAgent = new ToolLoopAgent({
  model: deepseek.chat(appConfig.model),
  instructions: appConfig.agent.instructions + systemPrompt,
  tools: {
    searchWeb,
  },
});
