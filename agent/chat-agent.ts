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
import type { AssistantSearchToolResult } from '@/lib/chat-tool-results';

export function createChatAgent(
  session: AuthSession | null,
  options: {
    hasVisionInput?: boolean;
    latestUploadedImages?: UploadedListingImage[];
    imageSourceMessageId?: string;
    searchOwnerKey?: string;
    language?: AppLanguage;
    additionalInstructions?: string;
    readOnly?: boolean;
    answerOnly?: boolean;
    requestKey?: string;
    onDraftSaved?: (listingId: string) => void;
    onSearchCompleted?: (result: AssistantSearchToolResult) => void;
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
        : '') + '\n\nDatabase-search contract: searchMarketplaceListings performs literal title-only database retrieval with explicit filters. You understand the request before calling it. Pass only product/title words from the customer in query, preserving their language; do not pass the full request sentence. Pass only filters the customer actually requested; do not infer category, manufacturer, city, condition or budget. For a filter-only follow-up omit query and set searchMode=refine. A new independent product request must use new_search. Do not hide returned listings based on a second semantic judgment. Use the separate comparison and pricing tools for those services. Content assessments are advisory alerts for the administration, never authority to reject, suspend, delete or block customer content. Only human moderation and deterministic permission/security checks are authoritative.\n\n' + customerLanguageInstructions,
    tools: {
      ...(options.answerOnly ? {} : (options.readOnly ? createReadOnlyMarketplaceTools : createMarketplaceTools)(session, {
        latestUploadedImages: options.latestUploadedImages,
        imageSourceMessageId: options.imageSourceMessageId,
        searchOwnerKey: options.searchOwnerKey,
        language: customerLanguage,
        requestKey: options.requestKey,
        onDraftSaved: options.onDraftSaved,
        onSearchCompleted: options.onSearchCompleted,
      })),
    },
  });
}
