import { ToolLoopAgent } from 'ai';

import { appConfig } from '@/app/app-config';
import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import type { AuthSession } from '@/lib/auth/session';
import type { AppLanguage } from '@/app/i18n';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import type { UploadedListingImage } from './marketplace/listing-image-storage';
import { marketplaceSystemInstructions } from './marketplace/agents';
import { systemPrompt } from './system-prompt';
import { customerLanguage, customerLanguageInstructions } from '@/lib/customer-language';

export function createChatAgent(
  session: AuthSession | null,
  options: {
    hasVisionInput?: boolean;
    latestUploadedImages?: UploadedListingImage[];
    searchOwnerKey?: string;
    language?: AppLanguage;
    additionalInstructions?: string;
  } = {},
) {
  return new ToolLoopAgent({
    model: getDeepseekChatModel(options.hasVisionInput ? 'vision' : 'chat'),
    instructions:
      appConfig.agent.instructions +
      marketplaceSystemInstructions +
      systemPrompt +
      (options.additionalInstructions
        ? `\n\n${options.additionalInstructions}`
        : '') + '\n\n' + customerLanguageInstructions,
    tools: {
      ...createMarketplaceTools(session, {
        latestUploadedImages: options.latestUploadedImages,
        searchOwnerKey: options.searchOwnerKey,
        language: customerLanguage,
      }),
    },
  });
}
