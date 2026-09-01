import { ToolLoopAgent } from 'ai';

import { appConfig } from '@/app/app-config';
import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import { searchProducts } from '@/agent/tools/product-search';
import { searchWeb } from '@/agent/tools/web-search';
import { systemPrompt } from './system-prompt';

export const chatAgent = new ToolLoopAgent({
  model: getDeepseekChatModel(),
  instructions: appConfig.agent.instructions + systemPrompt,
  tools: {
    searchProducts,
    searchWeb,
  },
});
