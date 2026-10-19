import { tool } from 'ai';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { marketplaceCategoryPrompt } from '@/lib/marketplace/categories';
import { z } from 'zod';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { reviewListingImageContent } from '@/agent/marketplace/listing-image-content';
import {
  saveUploadedListingImagesForSeller,
  type UploadedListingImage,
} from '@/agent/marketplace/listing-image-storage';
import {
  getMaxListingsPerSeller,
  isListingLimitReachedError,
} from '@/agent/marketplace/listing-limits';
import {
  createListingDraft,
  getListing,
  listMarketplaceListings,
  listSellerListings,
  updateListingForSeller,
  type CreateListingInput,
} from '@/agent/marketplace/repository';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import { prepareListingUnderstanding } from '@/agent/marketplace/text-understanding';
import { marketplaceSearchUnderstandingSchema } from '@/agent/marketplace/search-understanding-schema';
import { compareMarketplaceListings as compareListingsWithEngine } from '@/agent/marketplace/comparison-engine';
import { recommendListingPrice } from '@/agent/marketplace/pricing-engine';
import { evaluateNegotiationOffer } from '@/agent/marketplace/negotiation-engine';
import type { AuthSession } from '@/lib/auth/session';
import type { AppLanguage } from '@/app/i18n';
import { getPublicListingUrl } from '@/lib/listing-url';
import type { AssistantSearchToolResult } from '@/lib/chat-tool-results';

type MarketplaceListingResult = Awaited<
  ReturnType<typeof listMarketplaceListings>
>[number];

function authRequired() {
  return {
    status: 'auth_required' as const,
    message:
      'Sign-in with Google or Apple is required before using Hamad chat or account-bound marketplace actions.',
  };
}

function getListingSearchSummary(listing: MarketplaceListingResult) {
  const primaryImage = listing.images.find((image) => image.status === 'approved');

  return {
    id: listing.id,
    listingUrl: getPublicListingUrl(listing.id),
    title: listing.title,
    category: listing.category,
    price: listing.price,
    city: listing.city,
    condition: listing.condition,
    description: listing.description,
    attributes: listing.attributes,
    image:
      primaryImage?.thumbnailUrl ??
      primaryImage?.displayUrl ??
      primaryImage?.originalUrl,
    imageUrls: [
      primaryImage?.thumbnailUrl,
      primaryImage?.displayUrl,
      primaryImage?.originalUrl,
    ].filter(Boolean),
    views: listing.views,
    messageCount: listing.messageCount,
    favoriteCount: listing.favoriteCount,
  };
}

function getRankedListingSearchSummary(
  result: Awaited<ReturnType<typeof searchMarketplaceWithState>>['listings'][number],
) {
  return {
    ...getListingSearchSummary(result.listing),
    matchScore: result.scores.finalScore,
    scores: result.scores,
    reasons: result.reasons,
  };
}

function getComparisonListingSummary(
  item: ReturnType<typeof compareListingsWithEngine>['target'],
) {
  return {
    ...getListingSearchSummary(item.listing),
    overallScore: item.overallScore,
    priceScore: item.priceScore,
    conditionScore: item.conditionScore,
    mileageScore: item.mileageScore,
    specsScore: item.specsScore,
    locationScore: item.locationScore,
    listingQualityScore: item.listingQualityScore,
    marketValueScore: item.marketValueScore,
    labels: item.labels,
    reasons: item.reasons,
  };
}

const listingDetailsSchema = {
  autoCategory: z.boolean().optional().describe('Use true only when the seller has not explicitly selected a category; infer from title and description if possible. Preserve an explicit seller category.'),
  category: z.string().min(2).describe(`Marketplace category ID: ${marketplaceCategoryPrompt}. Preserve an explicit seller category.`),
  title: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  price: z
    .union([z.number().nonnegative(), z.enum(['bid', 'negotiable'])])
    .optional(),
  city: z.string().min(2).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  saleTerms: z
    .enum(['fixed', 'negotiable', 'auction', 'open_to_offers'])
    .describe(
      'Use fixed when the seller says the numeric price is not negotiable.',
    )
    .optional(),
  usageNotes: z
    .string()
    .min(2)
    .describe('Short honest usage details confirmed by the seller.')
    .optional(),
  defects: z
    .string()
    .min(2)
    .describe('Known defects, or a clear statement such as no defects.')
    .optional(),
  color: z.string().min(2).optional(),
  material: z.string().min(2).optional(),
  brand: z.string().min(2).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
};

const listingDetailsInputSchema = z.object(listingDetailsSchema);
const uploadedImageSelection = {
  imageIndexes: z.array(z.number().int().nonnegative()).max(8).optional()
    .describe('Explicit zero-based indexes of photos for this product only. Omit or use [] for no photos. Never inherit earlier product photos or attach every photo to each separate draft.'),
  imageSourceMessageId: z.string().min(1).max(200).optional()
    .describe('Exact sourceMessageId from the uploaded-image context. Earlier uploads may be selected only for the same product or an explicit customer request to reuse those photos.'),
};
const createDraftInputSchema = listingDetailsInputSchema.extend(uploadedImageSelection);
const updateListingDetailsInputSchema = listingDetailsInputSchema
  .partial()
  .extend({
    listingId: z.string().min(1).optional(),
    confirmedPriceChange: z
      .boolean()
      .describe(
        'Set true only after the seller explicitly confirms the requested price change.',
      )
      .optional(),
  });

type ListingDetailsInput = z.infer<typeof listingDetailsInputSchema>;

function normalizeListingDetailsInput(
  input: Partial<ListingDetailsInput>,
): Partial<CreateListingInput> {
  const {
    saleTerms,
    usageNotes,
    defects,
    color,
    material,
    brand,
    attributes,
    ...listingInput
  } = input;

  return {
    ...listingInput,
    attributes: {
      ...(attributes ?? {}),
      ...(saleTerms ? { saleTerms } : {}),
      ...(usageNotes ? { usageNotes } : {}),
      ...(defects ? { defects } : {}),
      ...(color ? { color } : {}),
      ...(material ? { material } : {}),
      ...(brand ? { brand } : {}),
    },
  };
}

function confirmationRequired(message: string) {
  return {
    status: 'needs_confirmation' as const,
    message,
  };
}


async function getCurrentEditableSellerListing({
  sellerId,
  listingId,
}: {
  sellerId: string;
  listingId?: string;
}) {
  if (listingId) {
    const listing = await getListing(listingId);
    return listing && listing.sellerId === sellerId ? listing : null;
  }

  const listings = await listSellerListings(sellerId);

  return (
    listings.find((listing) =>
      listing.status === 'draft',
    ) ?? null
  );
}

export function createMarketplaceTools(
  session: AuthSession | null,
  options: {
    latestUploadedImages?: UploadedListingImage[];
    imageSourceMessageId?: string;
    searchOwnerKey?: string;
    language?: AppLanguage;
    requestKey?: string;
    onDraftSaved?: (listingId: string) => void;
    onSearchCompleted?: (result: AssistantSearchToolResult) => void;
  } = {},
) {
  const draftOperations = new Map<string, number>();
  const imageOwners = new Map<number, string>();
  function selectUploadedImages(input: z.infer<typeof createDraftInputSchema> | { imageIndexes?: number[]; imageSourceMessageId?: string }) {
    const indexes = [...new Set(input.imageIndexes ?? [])];
    if (indexes.length && ((options.imageSourceMessageId && input.imageSourceMessageId !== options.imageSourceMessageId)
      || indexes.some(index => !options.latestUploadedImages?.[index]))) return null;
    return indexes.map(index => ({ index, image: options.latestUploadedImages![index] }));
  }
  const tools = {
    searchMarketplaceListings: tool({
      description:
        'Search current published سوق حمد marketplace listings for a buyer only. Do not use this for seller requests to create, publish, prepare, price, or add a listing; seller listing creation must use createListingDraft. Understand the buyer request first, pass structured understoodIntent fields when possible, set searchMode="new_search" for a fresh broad product/category request, and set searchMode="refine" only when the buyer clearly narrows existing results. Use descriptiveTerms only for concrete product descriptors that do not fit structured fields. Do not pass search intent words or the whole user sentence as search terms. Use this before saying buyer listings are unavailable. This is read-only and never stores raw user search text as listing data.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(300).describe('Literal product/title words from the customer, preserving their language and spelling. Omit request wording, city and budget. This database tool does not interpret natural-language sentences or infer synonyms. For a filter-only refinement omit query.').optional(),
        understoodIntent: marketplaceSearchUnderstandingSchema.describe('Explicit customer-requested filters only. Never infer a category, manufacturer, city, budget, condition or feature that the customer did not request. Category discovery during listing creation is separate. Use new_search for independent requests and refine only for explicit follow-ups.').optional(),
      }),
      execute: async ({ query, understoodIntent }, execution) => {
        const searchResult = await searchMarketplaceWithState({
          ownerKey:
            options.searchOwnerKey ??
            (session ? `user:${session.user.id}` : 'anonymous'),
          userId: session?.user.id,
          query,
          understoodIntent,
          language: options.language,
        });

        const output = {
          status: searchResult.status,
          unavailablePreferences: understoodIntent?.sortPreference === 'closest' || understoodIntent?.locationPreference === 'nearby' ? ['geographic_distance'] : [],
          count: searchResult.listings.length,
          candidateCount: searchResult.candidateCount,
          rankedCount: searchResult.rankedCount,
          searchState: searchResult.searchState,
          listings: searchResult.listings.map(getRankedListingSearchSummary),
          recommendations: searchResult.recommendations,
          market: searchResult.market,
          relaxedSuggestion: searchResult.relaxedSuggestion,
          note:
            'Each search replaces prior server filters unless searchMode="refine" explicitly continues the current search. clearFilters removes previous constraints. Return only the latest visible matches. No geographic distance is calculated: if geographic_distance is unavailable, say so and offer the explicit city filter; never claim that the ordering is nearest by distance. Do not invent unavailable listings or market averages.',
        };
        options.onSearchCompleted?.({ toolCallId: execution.toolCallId, toolName: 'searchMarketplaceListings', input: { query, understoodIntent }, output });
        return output;
      },
    }),

    compareMarketplaceListings: tool({
      description:
        'Compare one specific published listing against similar سوق حمد marketplace listings. Use this when the user asks to compare a selected listing, especially if a listingId is provided. Return the target listing and comparable alternatives from real marketplace data only.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        query: z.string().trim().min(1).max(300).optional(),
        limit: z.number().int().min(2).max(12).optional(),
      }),
      execute: async ({ listingId, query, limit = 8 }, execution) => {
        const targetListing = await getListing(listingId);

        if (!targetListing || targetListing.status !== 'published') {
          return {
            status: 'not_found',
            message:
              'The listing was not found, deleted, or is not currently published.',
            listings: [],
          };
        }

        const comparisonQuery = query?.trim();
        const listings = await listMarketplaceListings(
          comparisonQuery
            ? {
                query: comparisonQuery,
                limit: Math.max(limit + 24, 30),
              }
            : {
                category: targetListing.category,
                city: targetListing.city,
                limit: Math.max(limit + 24, 30),
              },
        );
        await prepareListingUnderstanding([targetListing, ...listings]);
        const comparison = compareListingsWithEngine(
          targetListing,
          listings,
          limit,
        );

        const output = {
          status: 'compared' as const,
          target: getComparisonListingSummary(comparison.target),
          count: comparison.alternatives.length,
          listings: comparison.alternatives.map(getComparisonListingSummary),
          marketSummary: comparison.marketSummary,
          comparisonBasis:
            'Comparison scores and labels are computed from real سوق حمد listing data. Explain these values; do not invent market averages or unavailable alternatives.',
        };
        options.onSearchCompleted?.({ toolCallId: execution.toolCallId, toolName: 'compareMarketplaceListings', input: { listingId, query, limit }, output });
        return output;
      },
    }),

    estimateListingPrice: tool({
      description:
        'Estimate an honest seller price range using real comparable سوق حمد listings. Return a range, comparable count, confidence, and adjustments. Never present this as a guaranteed market price.',
      inputSchema: listingDetailsInputSchema,
      execute: async (input) => {
        const listingInput = normalizeListingDetailsInput(
          listingDetailsInputSchema.parse(input),
        ) as CreateListingInput;
        const comparableListings = await listMarketplaceListings({
          category: listingInput.category,
          city: listingInput.city,
          limit: 80,
        });

        await prepareListingUnderstanding([{ ...listingInput, attributes: listingInput.attributes ?? {} }, ...comparableListings]);
        return recommendListingPrice(listingInput, comparableListings);
      },
    }),

    evaluateNegotiationOffer: tool({
      description:
        'Evaluate a buyer offer for a specific published listing using asking price and comparable سوق حمد listings. This gives private advisory guidance only and never sends messages, accepts, rejects, changes prices, or commits to a deal.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        buyerOffer: z.number().nonnegative(),
      }),
      execute: async ({ listingId, buyerOffer }) => {
        const listing = await getListing(listingId);

        if (!listing || listing.status !== 'published') {
          return {
            status: 'not_found',
            message:
              'The listing was not found, deleted, or is not currently published.',
          };
        }

        const comparableListings = await listMarketplaceListings({
          category: listing.category,
          city: listing.city,
          limit: 80,
        });

        await prepareListingUnderstanding([listing, ...comparableListings]);
        return {
          status: 'evaluated',
          advice: evaluateNegotiationOffer(
            listing,
            buyerOffer,
            comparableListings,
          ),
          note:
            'This is private guidance only. Do not send a message, accept, reject, change price, or commit to a deal.',
        };
      },
    }),

    createListingDraft: tool({
      description:
        'Create an owned unpublished marketplace draft from a natural seller conversation with a minimum product signal. Preserve confirmed details in title, description, price, city, condition, category and attributes, including model, year, mileage, specs, accessories, warranty, defects, color, material, brand, sale terms and seller notes. Automated policy concerns are advisory administration alerts, not authority to reject customer content. Respect explicit human moderation and technical permissions.',
      inputSchema: createDraftInputSchema,
      execute: async (input) => {
        if (!session) {
          return authRequired();
        }

        const selection = selectUploadedImages(createDraftInputSchema.parse(input));
        if (!selection) return { status: 'invalid_image_selection', message: 'Choose only indexes from the exact available image source; no draft or photos were saved.' };
        const listingInput = normalizeListingDetailsInput(
          listingDetailsInputSchema.parse(input),
        ) as CreateListingInput;
        let listing: Awaited<ReturnType<typeof createListingDraft>>;
        let imageUploadUnavailable = false;

        try {
          const signature = JSON.stringify({ ...listingInput, imageIndexes: input.imageIndexes, imageSourceMessageId: input.imageSourceMessageId }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
          if (!draftOperations.has(signature)) draftOperations.set(signature, draftOperations.size);
          const idempotencyKey = options.requestKey ? createHash('sha256').update(JSON.stringify([session.user.id, options.requestKey, draftOperations.get(signature)])).digest('hex') : undefined;
          listing = await createListingDraft(session.user, listingInput, { idempotencyKey });
          if (listing.status === 'draft') options.onDraftSaved?.(listing.id);
        } catch (error) {
          if (isListingLimitReachedError(error)) {
            const maxListings = getMaxListingsPerSeller();

            return {
              status: 'limit_reached',
              message: `This account has reached the maximum of ${maxListings} saved listings. Ask the seller to delete an old listing before creating a new one.`,
              maxListings,
            };
          }

          throw error;
        }

        if (listing.status !== 'draft' && listing.status !== 'pending') return {
          status: 'already_saved', listing,
          message: 'This request already saved the listing. Do not create another or modify its current state; guide the user to Account > My listings.',
        };

        if (listing.compliance.humanDecision === 'block') {
          return {
            status: 'blocked',
            message:
              'An explicit administration decision restricts this listing. Do not bypass it.',
            listing,
          };
        }

        const imageSelectionConflict = selection.some(({ index }) => imageOwners.has(index) && imageOwners.get(index) !== listing.id);
        if (selection.length && !imageSelectionConflict) {
          selection.forEach(({ index }) => imageOwners.set(index, listing.id));
          const images = selection.map(({ image }) => image);
          const review = await reviewListingImageContent(images, listing.images, { listingId: listing.id, userId: session.user.id });
          const listingWithImages = await saveUploadedListingImagesForSeller({
            listingId: listing.id,
            sellerId: session.user.id,
            images,
            contentReviewStatuses: review.imageReviewStatuses,
            draftOnly: true,
          }).catch((error: unknown) => {
            imageUploadUnavailable = true;
            console.warn(`[draft_image_upload] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
            return null;
          });

          if (listingWithImages) {
            listing = listingWithImages;
          }
        }

        return {
          status: listing.status === 'pending' ? 'needs_review' : 'draft_created',
          imageSelectionConflict,
          message:
            listing.status === 'pending'
              ? 'Draft created for manual review. Do not publish directly.'
              : imageSelectionConflict
                ? 'Draft created without photos: selected photos already belong to another product draft in this turn. Ask which remaining photos belong to this product; never copy unrelated photos.'
              : imageUploadUnavailable
                ? 'Draft created. Some photos could not be saved, but photos are optional and the seller can publish manually from Account > My listings.'
              : listing.images.some((image) => image.status === 'approved')
                ? 'Draft created with the uploaded product image. The seller must review and publish it from Account > My listings.'
                : 'Draft created. Photos are optional. Ask for useful missing details and direct the seller to Account > My listings when they want to publish.',
          listing,
        };
      },
    }),

    updateListing: tool({
      description:
        'Prepare details of an owned unpublished draft only. Never edit published, paused, sold, pending-review or deleted listings; direct the seller to Account > My listings for those changes. Preserve confirmed seller details and attributes. Omit listingId only to select the latest owned draft. A new standalone product requires a new draft. A draft price change requires confirmedPriceChange=true.',
      inputSchema: updateListingDetailsInputSchema,
      execute: async (input) => {
        if (!session) {
          return authRequired();
        }

        const { listingId, confirmedPriceChange, ...updates } = updateListingDetailsInputSchema.parse(input);

        if (updates.price !== undefined && confirmedPriceChange !== true) {
          return confirmationRequired(
            'Confirm the price change explicitly before updating the listing price.',
          );
        }

        const targetListing = await getCurrentEditableSellerListing({
          sellerId: session.user.id,
          listingId,
        });

        if (!targetListing) {
          return {
            status: 'not_found',
            message:
              'No editable seller draft was found. If the seller has provided product details in this conversation but no saved draft exists, create the draft first, then apply these details.',
          };
        }

        if (targetListing.status !== 'draft') {
          return { status: 'user_action_required', message: 'Only unpublished drafts can be prepared in chat. Review and edit this listing yourself from Account > My listings.' };
        }

        const listing = await updateListingForSeller(
          targetListing.id,
          session.user.id,
          normalizeListingDetailsInput(updates),
          { draftOnly: true },
        );

        if (!listing) {
          return {
            status: 'not_found',
            message: 'Listing was not found or is not owned by this user.',
          };
        }

        options.onDraftSaved?.(listing.id);

        if (listing.compliance.humanDecision === 'block') {
          return {
            status: 'blocked',
            message:
              'An explicit administration decision restricts this listing. Do not bypass it.',
            listing,
          };
        }

        return {
          status: listing.status === 'pending' ? 'needs_review' : 'updated',
          listing,
        };
      },
    }),

    addUploadedImagesToListing: tool({
      description:
        'Prepare uploaded chat images on an owned unpublished draft only. Requires sign-in and a clear listingId. Never change images on published, paused, sold, pending-review or deleted listings; direct the seller to Account > My listings.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        ...uploadedImageSelection,
      }),
      execute: async ({ listingId, ...selectionInput }) => {
        if (!session) {
          return authRequired();
        }

        if (!options.latestUploadedImages?.length) {
          return {
            status: 'missing_images',
            message:
              'No uploaded listing images are available. Ask the user to attach JPG, PNG, or WEBP product images.',
          };
        }

        const targetListing = await getListing(listingId);

        if (!targetListing || targetListing.sellerId !== session.user.id) {
          return {
            status: 'not_found',
            message: 'Listing was not found or is not owned by this user.',
          };
        }

        if (targetListing.status !== 'draft') {
          return { status: 'user_action_required', message: 'Change images for non-draft listings yourself from Account > My listings.' };
        }

        const selection = selectUploadedImages(selectionInput);
        if (!selection?.length) return { status: 'invalid_image_selection', message: 'Explicitly select photos from the exact available source before attaching them.' };
        if (selection.some(({ index }) => imageOwners.has(index) && imageOwners.get(index) !== listingId)) {
          return { status: 'image_selection_conflict', message: 'These photos belong to a different product draft in this turn. Ask for the correct product photos.' };
        }
        selection.forEach(({ index }) => imageOwners.set(index, listingId));
        const images = selection.map(({ image }) => image);
        const review = await reviewListingImageContent(images, targetListing.images, { listingId, userId: session.user.id });
        const listing = await saveUploadedListingImagesForSeller({
          listingId,
          sellerId: session.user.id,
          images,
          contentReviewStatuses: review.imageReviewStatuses,
          draftOnly: true,
        });

        if (!listing) {
          return {
            status: 'not_found',
            message: 'Listing was not found or is not owned by this user.',
          };
        }

        options.onDraftSaved?.(listing.id);
        return {
          status: 'images_added',
          contentCheck: review.status,
          listing,
        };
      },
    }),


    analyzeListingImages: tool({
      description:
        'Read actual uploaded-image file metadata. This does not measure sharpness, lighting or product visibility, and never requires a retake or minimum resolution. The existing visual inspection supplies product understanding separately.',
      inputSchema: z.object({
        images: z
          .array(
            z.object({
              fileName: z.string().optional(),
              mimeType: z.string().optional(),
              sizeBytes: z.number().int().nonnegative().optional(),
              width: z.number().int().positive().optional(),
              height: z.number().int().positive().optional(),
              hasDetectedPhoneNumber: z.boolean().optional(),
              hasDetectedSensitiveInfo: z.boolean().optional(),
              isRelevantToListing: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(10).optional(),
      }),
      execute: async () => {
        if (!options.latestUploadedImages?.length) return { status: 'missing_images', results: [] };
        const results = await Promise.all(options.latestUploadedImages.map(async image => {
          try {
            const metadata = await sharp(image.data).metadata();
            return { ...analyzeImageQuality({ mimeType: image.mediaType, sizeBytes: image.data.byteLength, width: metadata.width, height: metadata.height }), qualityScore: null };
          } catch { return { assessmentStatus: 'unavailable' as const, qualityScore: null }; }
        }));
        return { status: 'metadata_only', results, note: 'No visual-quality measurement or image enhancement was performed. Do not invent image-quality claims.' };
      },
    }),

  };
  return tools;
}

export function createReadOnlyMarketplaceTools(session: AuthSession | null, options: Parameters<typeof createMarketplaceTools>[1] = {}) {
  const { searchMarketplaceListings, compareMarketplaceListings, estimateListingPrice, evaluateNegotiationOffer, analyzeListingImages } = createMarketplaceTools(session, options);
  return { searchMarketplaceListings, compareMarketplaceListings, estimateListingPrice, evaluateNegotiationOffer, analyzeListingImages };
}
