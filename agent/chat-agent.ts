import { ToolLoopAgent } from 'ai';

import { appConfig } from '@/app/app-config';
import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import type { AuthSession } from '@/lib/auth/session';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { marketplaceSystemInstructions } from './marketplace/agents';
import { systemPrompt } from './system-prompt';

export function createChatAgent(
  session: AuthSession | null,
  options: { hasVisionInput?: boolean } = {},
) {
  return new ToolLoopAgent({
    model: getDeepseekChatModel(options.hasVisionInput ? 'vision' : 'chat'),
    instructions:
      appConfig.agent.instructions + marketplaceSystemInstructions + systemPrompt,
    tools: {
      ...createMarketplaceTools(session),
    },
  });
}
