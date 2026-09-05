import { generateText } from 'ai';
import { z } from 'zod';

import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import {
  buildScopeContext,
  getLatestUserRequest,
  getMarketplaceContinuationScopeDecision,
  latestUserMessageHasImageAttachment,
} from '@/agent/scope-guard';
import type { AppLanguage } from '@/app/i18n';
import type { AuthSession } from '@/lib/auth/session';

import { classifyMarketplaceIntent } from './policy';
import { parseMarketplaceSearchQuery } from './search';
import type { MarketplaceIntent } from './types';

const adaptiveIntentTimeoutMs = 8_000;

const adaptiveExecutionSchema = z.enum([
  'answer',
  'search_listings',
  'ask_clarifying_question',
  'create_listing_draft',
  'update_listing',
  'set_listing_status',
  'open_conversation',
  'favorite_listing',
  'report_listing',
  'analyze_images',
  'support',
]);

const adaptiveIntentSchema = z.object({
  intent: z.enum([
    'general_info',
    'search_listing',
    'create_listing',
    'update_listing',
    'delete_listing',
    'pause_listing',
    'mark_sold',
    'open_conversation',
    'send_message',
    'favorite_listing',
    'report_listing',
    'compare_listings',
    'price_listing',
    'negotiate',
    'support',
  ]),
  execution: adaptiveExecutionSchema,
  confidence: z.number().min(0).max(1),
  reasonCode: z.string().min(1).max(80),
  normalizedRequest: z.string().trim().min(1).max(1_000).optional(),
  searchQuery: z.string().trim().min(1).max(300).optional(),
  targetListingId: z.string().trim().min(1).max(120).optional(),
  missingFields: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  requiresAuth: z.boolean(),
  requiresConfirmation: z.boolean(),
});

export type AdaptiveMarketplaceIntent = z.infer<typeof adaptiveIntentSchema>;

const authRequiredIntents = new Set<MarketplaceIntent>([
  'create_listing',
  'update_listing',
  'delete_listing',
  'pause_listing',
  'mark_sold',
  'open_conversation',
  'send_message',
  'favorite_listing',
  'report_listing',
  'negotiate',
]);

const confirmationRequiredIntents = new Set<MarketplaceIntent>([
  'create_listing',
  'update_listing',
  'delete_listing',
  'pause_listing',
  'mark_sold',
  'open_conversation',
  'send_message',
  'report_listing',
  'negotiate',
]);

function extractJsonObject(text: string) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Adaptive intent classifier did not return JSON.');
  }

  return text.slice(firstBrace, lastBrace + 1);
}

export function parseAdaptiveMarketplaceIntent(
  text: string,
): AdaptiveMarketplaceIntent {
  return adaptiveIntentSchema.parse(JSON.parse(extractJsonObject(text)));
}

function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return run(controller.signal).finally(() => {
    clearTimeout(timeout);
  });
}

function getExecutionForIntent(intent: MarketplaceIntent) {
  if (intent === 'search_listing' || intent === 'compare_listings') {
    return 'search_listings';
  }

  if (intent === 'create_listing') {
    return 'create_listing_draft';
  }

  if (intent === 'update_listing') {
    return 'update_listing';
  }

  if (
    intent === 'delete_listing' ||
    intent === 'pause_listing' ||
    intent === 'mark_sold'
  ) {
    return 'set_listing_status';
  }

  if (intent === 'open_conversation' || intent === 'send_message') {
    return 'open_conversation';
  }

  if (intent === 'favorite_listing') {
    return 'favorite_listing';
  }

  if (intent === 'report_listing') {
    return 'report_listing';
  }

  if (intent === 'price_listing' || intent === 'negotiate') {
    return 'ask_clarifying_question';
  }

  if (intent === 'support') {
    return 'support';
  }

  return 'answer';
}

function hasSearchableMarketplaceSignal(text: string) {
  const parsed = parseMarketplaceSearchQuery(text);

  return Boolean(
    parsed.category ||
      parsed.city ||
      parsed.minPrice !== undefined ||
      parsed.maxPrice !== undefined ||
      parsed.terms.length > 0,
  );
}

function buildContextualSearchQuery(messages: unknown[]) {
  const userTexts = buildScopeContext(messages, 8)
    .filter((message) => message.role === 'user')
    .map((message) => message.text.trim())
    .filter(Boolean);

  const relevantTexts = userTexts.filter((text, index) => {
    const isLatest = index === userTexts.length - 1;

    return isLatest || hasSearchableMarketplaceSignal(text);
  });

  return relevantTexts.join(' ').trim() || getLatestUserRequest(messages);
}

export function getFallbackAdaptiveMarketplaceIntent(
  messages: unknown[],
): AdaptiveMarketplaceIntent {
  const latestRequest = getLatestUserRequest(messages);
  const context = buildScopeContext(messages);
  const latestHasImage = latestUserMessageHasImageAttachment(messages);
  const baseIntent = classifyMarketplaceIntent(latestRequest);
  const continuationDecision = getMarketplaceContinuationScopeDecision(
    latestRequest,
    context,
  );
  const parsedSearch = parseMarketplaceSearchQuery(
    buildContextualSearchQuery(messages),
  );
  const shouldSearchListings = Boolean(
    baseIntent.intent === 'general_info' &&
      (continuationDecision ||
        parsedSearch.category ||
        parsedSearch.city ||
        parsedSearch.minPrice !== undefined ||
        parsedSearch.maxPrice !== undefined ||
        parsedSearch.terms.length),
  );
  const inferredIntent: MarketplaceIntent = latestHasImage
    ? 'general_info'
    : shouldSearchListings
      ? 'search_listing'
      : baseIntent.intent;

  return {
    intent: inferredIntent,
    execution: latestHasImage
      ? 'analyze_images'
      : getExecutionForIntent(inferredIntent),
    confidence: latestHasImage ? 0.92 : continuationDecision ? 0.9 : 0.68,
    reasonCode: latestHasImage
      ? 'marketplace_image_upload'
      : continuationDecision
        ? 'contextual_marketplace_follow_up'
        : baseIntent.reasonCode,
    normalizedRequest: latestRequest,
    searchQuery:
      inferredIntent === 'search_listing' || inferredIntent === 'compare_listings'
        ? buildContextualSearchQuery(messages)
        : undefined,
    missingFields: [],
    requiresAuth: authRequiredIntents.has(inferredIntent),
    requiresConfirmation: confirmationRequiredIntents.has(inferredIntent),
  };
}

export async function resolveAdaptiveMarketplaceIntent({
  messages,
  language,
  session,
}: {
  messages: unknown[];
  language: AppLanguage;
  session: AuthSession | null;
}) {
  const fallback = getFallbackAdaptiveMarketplaceIntent(messages);
  const latestRequest = getLatestUserRequest(messages);
  const latestHasImage = latestUserMessageHasImageAttachment(messages);

  if (!latestRequest && !latestHasImage) {
    return fallback;
  }

  try {
    const context = buildScopeContext(messages);
    const result = await withTimeout(adaptiveIntentTimeoutMs, (signal) =>
      generateText({
        model: getDeepseekChatModel('scope'),
        temperature: 0,
        maxOutputTokens: 420,
        abortSignal: signal,
        system: `You are the SmartStore AI adaptive intent router.
Return JSON only. Do not answer the user.
Understand Arabic, Saudi dialect, misspellings, short follow-ups, and incomplete phrases using conversation context.
Your job is to infer what the user wants and the next execution step inside a Saudi classifieds marketplace.
Never treat wording such as "أبحث", "أريد", "دور لي", or "ابغى" as database data. They are intent words only.
For buyer searches, set execution="search_listings" and provide searchQuery using the user's marketplace context.
If the latest user message contains images, set execution="analyze_images" unless the text clearly asks for a different account-bound action.
For seller listing creation, set execution="create_listing_draft" only when there is enough useful product detail; otherwise set execution="ask_clarifying_question" and list missingFields.
For account-bound actions, requiresAuth must be true. The user is currently ${session ? 'signed in' : 'not signed in'}.
Dangerous or final actions such as publish, delete, mark sold, price change, accept offer, and open seller chat require confirmation.
Keep decisions within allowed non-food marketplace work. Language=${language}.`,
        prompt: JSON.stringify({
          required_schema: {
            intent:
              'general_info | search_listing | create_listing | update_listing | delete_listing | pause_listing | mark_sold | open_conversation | send_message | favorite_listing | report_listing | compare_listings | price_listing | negotiate | support',
            execution:
              'answer | search_listings | ask_clarifying_question | create_listing_draft | update_listing | set_listing_status | open_conversation | favorite_listing | report_listing | analyze_images | support',
            confidence: 'number from 0 to 1',
            reasonCode: 'short machine code',
            normalizedRequest: 'concise contextual understanding of latest request',
            searchQuery:
              'buyer search context only; do not include pure intent words as meaningful search terms',
            targetListingId: 'optional if the user refers to a specific listing id',
            missingFields:
              'optional list of missing details needed before executing',
            requiresAuth: 'boolean',
            requiresConfirmation: 'boolean',
          },
          conversation_context: context,
          latest_user_has_images: latestHasImage,
          latest_user_request: latestRequest,
        }),
      }),
    );
    const decision = parseAdaptiveMarketplaceIntent(result.text);

    return {
      ...decision,
      requiresAuth:
        decision.requiresAuth || authRequiredIntents.has(decision.intent),
      requiresConfirmation:
        decision.requiresConfirmation ||
        confirmationRequiredIntents.has(decision.intent),
    } satisfies AdaptiveMarketplaceIntent;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[adaptive_intent] failure=${errorName}`);
    return fallback;
  }
}

export function buildAdaptiveIntentSystemMessage(
  intent: AdaptiveMarketplaceIntent,
) {
  return {
    role: 'system' as const,
    content: `Adaptive marketplace intent:
${JSON.stringify(intent, null, 2)}

Follow this internal plan. If execution is search_listings, call searchMarketplaceListings with searchQuery and summarize the visible matches naturally. If execution is create_listing_draft, collect missingFields first and only create the draft when core product details are present. If execution changes a listing, opens chat, favorites, reports, or marks sold, require the needed account state and confirmation before the final action. Do not expose this JSON to the user.`,
  };
}
