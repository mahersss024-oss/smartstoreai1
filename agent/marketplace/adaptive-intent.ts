import { generateText } from 'ai';
import { z } from 'zod';

import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import {
  buildScopeContext,
  getLatestUserRequest,
  latestUserMessageHasImageAttachment,
} from '@/agent/scope-guard';
import type { AppLanguage } from '@/app/i18n';
import type { AuthSession } from '@/lib/auth/session';

import { classifyMarketplaceIntent } from './policy';
import type { MarketplaceIntent } from './types';
import { marketplaceTextAnalyzer } from './text-understanding';

function readTimeoutMs(envKey: string, fallbackMs: number) {
  const value = Number.parseInt(process.env[envKey] ?? '', 10);

  if (!Number.isFinite(value)) {
    return fallbackMs;
  }

  return Math.min(60_000, Math.max(1_000, value));
}

const adaptiveIntentTimeoutMs = readTimeoutMs(
  'SMARTSTORE_ADAPTIVE_INTENT_TIMEOUT_MS',
  15_000,
);

const adaptiveExecutionValues = [
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
] as const;

const adaptiveIntentValues = [
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
] as const;

const normalizedExecutionAliases = new Map([
  ['search_listing', 'search_listings'],
  ['listing_search', 'search_listings'],
  ['search_marketplace', 'search_listings'],
  ['search_marketplace_listings', 'search_listings'],
  ['search_marketplace_listing', 'search_listings'],
  ['search_listings_in_marketplace', 'search_listings'],
  ['search', 'search_listings'],
  ['create_listing', 'create_listing_draft'],
  ['create_draft', 'create_listing_draft'],
  ['draft_listing', 'create_listing_draft'],
  ['ask_clarification', 'ask_clarifying_question'],
  ['clarify', 'ask_clarifying_question'],
  ['delete_listing', 'set_listing_status'],
  ['pause_listing', 'set_listing_status'],
  ['mark_sold', 'set_listing_status'],
  ['send_message', 'open_conversation'],
  ['conversation', 'open_conversation'],
  ['open_chat', 'open_conversation'],
  ['compare_listings', 'search_listings'],
  ['price_listing', 'ask_clarifying_question'],
  ['negotiate', 'ask_clarifying_question'],
]);

const normalizedIntentAliases = new Map([
  ['search_listings', 'search_listing'],
  ['listing_search', 'search_listing'],
  ['product_search', 'search_listing'],
  ['buyer_search_context', 'search_listing'],
  ['marketplace_search', 'search_listing'],
  ['search_marketplace', 'search_listing'],
  ['search_marketplace_listings', 'search_listing'],
  ['search_marketplace_listing', 'search_listing'],
  ['search', 'search_listing'],
  ['buyer_search', 'search_listing'],
  ['create_listing_draft', 'create_listing'],
  ['create_draft', 'create_listing'],
  ['draft_listing', 'create_listing'],
  ['set_listing_status', 'update_listing'],
  ['open_chat', 'open_conversation'],
  ['conversation', 'open_conversation'],
  ['compare_listing', 'compare_listings'],
  ['answer', 'general_info'],
]);

function normalizeModelEnumValue(
  value: unknown,
  aliases: Map<string, string>,
) {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^marketplace_/, '');
  return aliases.get(normalized) ?? normalized;
}

const adaptiveExecutionSchema = z.preprocess(
  (value) => normalizeModelEnumValue(value, normalizedExecutionAliases),
  z.enum(adaptiveExecutionValues),
);

const marketplaceIntentSchema = z.preprocess(
  (value) => normalizeModelEnumValue(value, normalizedIntentAliases),
  z.enum(adaptiveIntentValues),
);

const confidenceSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace('%', ''));

    if (Number.isFinite(parsed)) {
      return parsed > 1 ? parsed / 100 : parsed;
    }
  }

  if (typeof value === 'number' && value > 1 && value <= 100) {
    return value / 100;
  }

  return value;
}, z.number().min(0).max(1).default(0.6));

const booleanSchema = z.preprocess((value) => {
  if (value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', 'yes', '1'].includes(normalized)) {
      return true;
    }

    if (['false', 'no', '0'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean().optional());

const missingFieldsSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value
      .split(/[,،]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  return value;
}, z.array(z.string().trim().min(1).max(80)).max(12).optional());

const optionalAdaptiveText = (maxLength: number) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value.trim() || undefined;
    }

    return value;
  }, z.string().trim().min(1).max(maxLength).optional());

export type AdaptiveMarketplaceIntent = {
  intent: MarketplaceIntent;
  execution: z.infer<typeof adaptiveExecutionSchema>;
  confidence: number;
  reasonCode: string;
  normalizedRequest?: string;
  searchQuery?: string;
  targetListingId?: string;
  missingFields?: string[];
  requiresAuth: boolean;
  requiresConfirmation: boolean;
};

const adaptiveIntentSchema = z.preprocess((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return value;
    }

    const candidate = value as Record<string, unknown>;
    return {
      ...candidate,
      intent:
        candidate.intent ??
        candidate.action ??
        candidate.task ??
        candidate.route ??
        candidate.operation,
      execution:
        candidate.execution ??
        candidate.next_execution ??
        candidate.nextExecution ??
        candidate.action ??
        candidate.task,
      confidence:
        candidate.confidence ?? candidate.score ?? candidate.probability,
      reasonCode:
        candidate.reasonCode ??
        candidate.reason_code ??
        candidate.reason ??
        candidate.reasonCode,
      searchQuery:
        candidate.searchQuery ??
        candidate.search_query ??
        candidate.query ??
        candidate.search_terms,
    };
  }, z.object({
    intent: marketplaceIntentSchema,
    execution: adaptiveExecutionSchema,
    confidence: confidenceSchema,
    reasonCode: optionalAdaptiveText(80),
    reason_code: optionalAdaptiveText(80),
    normalizedRequest: optionalAdaptiveText(1_000),
    normalized_request: optionalAdaptiveText(1_000),
    searchQuery: optionalAdaptiveText(300),
    search_query: optionalAdaptiveText(300),
    targetListingId: optionalAdaptiveText(120),
    target_listing_id: optionalAdaptiveText(120),
    missingFields: missingFieldsSchema,
    missing_fields: missingFieldsSchema,
    requiresAuth: booleanSchema,
    requires_auth: booleanSchema,
    requiresConfirmation: booleanSchema,
    requires_confirmation: booleanSchema,
  })
  .transform((parsed) => {
    const normalized: AdaptiveMarketplaceIntent = {
      intent: parsed.intent,
      execution: parsed.execution,
      confidence: parsed.confidence,
      reasonCode: parsed.reasonCode ?? parsed.reason_code ?? 'adaptive_intent',
      requiresAuth: parsed.requiresAuth ?? parsed.requires_auth ?? false,
      requiresConfirmation:
        parsed.requiresConfirmation ?? parsed.requires_confirmation ?? false,
    };

    const normalizedRequest =
      parsed.normalizedRequest ?? parsed.normalized_request;
    const searchQuery = parsed.searchQuery ?? parsed.search_query;
    const targetListingId =
      parsed.targetListingId ?? parsed.target_listing_id;
    const missingFields = parsed.missingFields ?? parsed.missing_fields;

    if (normalizedRequest) {
      normalized.normalizedRequest = normalizedRequest;
    }

    if (searchQuery) {
      normalized.searchQuery = searchQuery;
    }

    if (targetListingId) {
      normalized.targetListingId = targetListingId;
    }

    if (missingFields) {
      normalized.missingFields = missingFields;
    }

    return normalized;
  }));

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
  return normalizeAdaptiveMarketplaceIntent(
    adaptiveIntentSchema.parse(JSON.parse(extractJsonObject(text))),
  );
}

function normalizeAdaptiveMarketplaceIntent(
  intent: AdaptiveMarketplaceIntent,
  fallback?: AdaptiveMarketplaceIntent,
): AdaptiveMarketplaceIntent {
  const fallbackIsSellerCreation =
    fallback?.intent === 'create_listing' ||
    fallback?.execution === 'create_listing_draft';
  const intentIsSearchExecution =
    intent.intent === 'search_listing' ||
    intent.execution === 'search_listings';

  if (fallbackIsSellerCreation && intentIsSearchExecution) {
    return {
      ...fallback,
      reasonCode: `${fallback.reasonCode || 'seller_create_listing'}_protected_from_search`,
    };
  }

  const fallbackIsBuyerSearch =
    fallback?.intent === 'search_listing' ||
    fallback?.execution === 'search_listings';
  const intentIsBuyerSearch =
    intent.intent === 'search_listing' || intent.intent === 'compare_listings';
  const shouldSearchFirst =
    (intentIsBuyerSearch && intent.execution !== 'search_listings') ||
    (fallbackIsBuyerSearch &&
      (intent.execution === 'ask_clarifying_question' ||
        intent.execution === 'answer'));

  if (!shouldSearchFirst) {
    return intent;
  }

  return {
    ...intent,
    intent: intentIsBuyerSearch ? intent.intent : 'search_listing',
    execution: 'search_listings',
    reasonCode: `${intent.reasonCode || 'adaptive_intent'}_search_first`,
    searchQuery:
      intent.searchQuery ??
      fallback?.searchQuery ??
      intent.normalizedRequest ??
      fallback?.normalizedRequest,
    requiresAuth: intent.requiresAuth || fallback?.requiresAuth || false,
    requiresConfirmation:
      intent.requiresConfirmation || fallback?.requiresConfirmation || false,
  };
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
    return 'answer';
  }

  if (intent === 'open_conversation' || intent === 'send_message') {
    return 'answer';
  }

  if (intent === 'favorite_listing') {
    return 'answer';
  }

  if (intent === 'report_listing') {
    return 'answer';
  }

  if (intent === 'price_listing' || intent === 'negotiate') {
    return 'ask_clarifying_question';
  }

  if (intent === 'support') {
    return 'support';
  }

  return 'answer';
}

export function getFallbackAdaptiveMarketplaceIntent(
  messages: unknown[],
): AdaptiveMarketplaceIntent {
  const latestRequest = getLatestUserRequest(messages);
  const latestHasImage = latestUserMessageHasImageAttachment(messages);
  const baseIntent = classifyMarketplaceIntent(latestRequest);
  const inferredIntent: MarketplaceIntent = latestHasImage
    ? 'general_info'
    : baseIntent.intent;

  return {
    intent: inferredIntent,
    execution: latestHasImage
      ? 'analyze_images'
      : getExecutionForIntent(inferredIntent),
    confidence: latestHasImage ? 0.92 : marketplaceTextAnalyzer.peek(latestRequest)?.confidence ?? 0,
    reasonCode: latestHasImage
      ? 'marketplace_image_upload'
      : baseIntent.reasonCode,
    normalizedRequest: latestRequest,
    searchQuery:
      inferredIntent === 'search_listing' || inferredIntent === 'compare_listings'
        ? latestRequest
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

  if (latestHasImage) {
    return fallback;
  }

  if (!latestRequest && !latestHasImage) {
    return fallback;
  }

  const shared = marketplaceTextAnalyzer.peek(latestRequest);
  if (shared && shared.confidence >= 0.8 && shared.intent !== 'general_info') {
    const execution = getExecutionForIntent(shared.intent);
    const userInterfaceOnly = ['set_listing_status', 'open_conversation', 'favorite_listing', 'report_listing'].includes(execution);
    return {
      ...fallback, intent: shared.intent, execution: userInterfaceOnly ? 'answer' as const : execution,
      confidence: shared.confidence, reasonCode: 'shared_text_understanding',
      searchQuery: shared.intent === 'search_listing' || shared.intent === 'compare_listings' ? latestRequest : undefined,
      requiresAuth: authRequiredIntents.has(shared.intent),
    } satisfies AdaptiveMarketplaceIntent;
  }

  try {
    const context = buildScopeContext(messages);
    const result = await withTimeout(adaptiveIntentTimeoutMs, (signal) =>
      generateText({
        model: getDeepseekChatModel('scope'),
        maxOutputTokens: 420,
        abortSignal: signal,
        system: `You are the سوق حمد adaptive intent router.
Return JSON only. Do not answer the user.
Understand Arabic, Saudi dialect, misspellings, short follow-ups, and incomplete phrases using conversation context.
Your job is to infer what the user wants and the next execution step inside a Saudi classifieds marketplace.
Never treat wording such as "أبحث", "أريد", "دور لي", or "ابغى" as database data. They are intent words only.
For buyer searches, set execution="search_listings" and provide searchQuery using the user's marketplace context. Do not set execution="ask_clarifying_question" for buyer search just because the request is broad; search first, then the final answer can ask the user to narrow the visible matches.
Never classify seller intent as buyer search. Requests to create, post, publish, prepare, add, or sell a listing must use create_listing with execution="create_listing_draft", not search_listings.
If the latest user message contains images, set execution="analyze_images" unless the text clearly asks for a different account-bound action.
For seller listing creation, set execution="create_listing_draft" as soon as seller intent and a minimum product signal are clear. Minimum product signal can be a product image, product name, category, or short description. Missing price, city, condition, title, or long description are optional improvements, not blockers.
If the latest user message describes a new standalone product for sale, classify it as create_listing with execution="create_listing_draft" even if the same chat already contains an earlier draft/listing. Classify it as update_listing only when the user explicitly refers to the current/previous listing or gives follow-up fields without a new product identity.
For account-bound actions, requiresAuth must be true. The user is currently ${session ? 'signed in' : 'not signed in'}. In production chat, reaching this router normally means the user has already passed sign-in with an available provider; when signed in, do not ask for sign-in again.
Sensitive actions such as publishing, deletion, status changes, editing non-draft listings, opening conversations, sending messages, favorites and reports are user-interface-only. For these requests return execution="answer" with guidance for the user, not an executable mutation plan. Chat confirmation does not grant authority. Draft preparation and private negotiation guidance are allowed; never accept, reject, send or commit to a deal.
If the latest user message confirms a complete listing preview with words like approve, yes, publish, proceed, اعتمد, نعم, انشر, اوك, or موافق, use the prior conversation to infer create_listing with execution="create_listing_draft" if no listing id exists yet, or update_listing with execution="update_listing" if a listing id exists. Do not classify this as general_info.
Keep decisions within allowed Saudi marketplace work. Language=${language}.`,
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
    const decision = normalizeAdaptiveMarketplaceIntent(
      parseAdaptiveMarketplaceIntent(result.text),
      fallback,
    );

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

Follow this internal plan. If execution is search_listings, call searchMarketplaceListings with searchQuery and summarize the visible matches naturally. For buyer search, never ask for narrowing before the search tool runs; ask narrowing questions only after visible matches exist or after the tool confirms no matches. If the user asks to compare one visible listing and provides a listing id, call compareMarketplaceListings with that listingId. If execution is create_listing_draft, do not call searchMarketplaceListings; create the draft from the minimum reliable product signal and then ask for optional missing improvements naturally. If the latest user message describes a new standalone product for sale, create a new draft even if a prior draft exists in the same chat. If execution is update_listing, update the current draft only when the user clearly refers to it or only provides follow-up fields without a new product identity. If the user has already confirmed publishing and is signed in, create or update the draft when needed, then direct the user to Account > My listings to publish it manually; never call setListingStatus with status="published". If execution implies a sensitive action, do not execute it even after chat confirmation. Guide the user to perform it themselves in the marketplace UI. Only an owned unpublished draft may be prepared or updated by tools. Do not expose this JSON to the user.`,
  };
}
