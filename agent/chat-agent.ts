import { ToolLoopAgent } from 'ai';

import { appConfig } from '@/app/app-config';
import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import type { AuthSession } from '@/lib/auth/session';
import type { AppLanguage } from '@/app/i18n';
import { createMarketplaceTools, createReadOnlyMarketplaceTools } from '@/agent/tools/marketplace';
import type { UploadedListingImage } from './marketplace/listing-image-storage';
import { marketplaceSystemInstructions } from './marketplace/agents';
import { systemPrompt } from './system-prompt';
import { customerLanguage, customerLanguageInstructions } from '@/lib/customer-language';

export function createChatAgent(
  session: AuthSession | null,
  options: {
    hasVisionInput?: boolean;
    latestUploadedImages?: UploadedListingImage[];
    imageSourceMessageId?: string;
    language?: AppLanguage;
    additionalInstructions?: string;
    readOnly?: boolean;
    answerOnly?: boolean;
    allowDraftTools?: boolean;
    requestKey?: string;
    onDraftSaved?: (listingId: string) => void;
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
      ...(options.answerOnly ? {} : options.allowDraftTools !== true || options.readOnly ? createReadOnlyMarketplaceTools() : createMarketplaceTools(session, {
        latestUploadedImages: options.latestUploadedImages,
        imageSourceMessageId: options.imageSourceMessageId,
        language: customerLanguage,
        requestKey: options.requestKey,
        onDraftSaved: options.onDraftSaved,
      })),
    },
  });
}
