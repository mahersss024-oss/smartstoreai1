import { tool } from 'ai';
import { z } from 'zod';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import {
  saveUploadedListingImagesForSeller,
  type UploadedListingImage,
} from '@/agent/marketplace/listing-image-storage';
import { checkImageMarketplaceCompliance } from '@/agent/marketplace/vision-compliance';
import {
  createConversationForListing,
  createListingDraft,
  getListing,
  listMarketplaceListings,
  reportListing,
  setListingStatusForSeller,
  toggleFavoriteListing,
  updateListingForSeller,
  type CreateListingInput,
} from '@/agent/marketplace/repository';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import { compareMarketplaceListings as compareListingsWithEngine } from '@/agent/marketplace/comparison-engine';
import { recommendListingPrice } from '@/agent/marketplace/pricing-engine';
import { evaluateNegotiationOffer } from '@/agent/marketplace/negotiation-engine';
import type { AuthSession } from '@/lib/auth/session';

type MarketplaceListingResult = Awaited<
  ReturnType<typeof listMarketplaceListings>
>[number];

function authRequired() {
  return {
    status: 'auth_required' as const,
    message:
      'Google sign-in is required before account-bound marketplace actions. The user can still ask questions without signing in.',
  };
}

function getListingSearchSummary(listing: MarketplaceListingResult) {
  const primaryImage = listing.images.find((image) => image.status === 'approved');

  return {
    id: listing.id,
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

function buildListingText(input: {
  category: string;
  title?: string;
  description?: string;
  city?: string;
  condition?: string;
  attributes?: Record<string, unknown>;
}) {
  return [
    input.category,
    input.title,
    input.description,
    input.city,
    input.condition,
    Object.values(input.attributes ?? {}).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

const listingDetailsSchema = {
  category: z.string().min(2),
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
const updateListingDetailsInputSchema = listingDetailsInputSchema
  .partial()
  .extend({
    listingId: z.string().min(1),
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

function buildImageReviewMessages(
  images: UploadedListingImage[],
  listingText: string,
) {
  return [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `Listing text: ${listingText}`,
        },
        ...images.map((image) => ({
          type: 'file' as const,
          mediaType: image.mediaType,
          data: image.data,
        })),
      ],
    },
  ];
}

export function createMarketplaceTools(
  session: AuthSession | null,
  options: {
    latestUploadedImages?: UploadedListingImage[];
    searchOwnerKey?: string;
  } = {},
) {
  return {
    searchMarketplaceListings: tool({
      description:
        'Search current published SmartStore AI marketplace listings for a buyer. Use this before saying listings are unavailable. This is read-only and never stores the user search terms.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(300).optional(),
      }),
      execute: async ({ query }) => {
        const searchResult = await searchMarketplaceWithState({
          ownerKey:
            options.searchOwnerKey ??
            (session ? `user:${session.user.id}` : 'anonymous'),
          query,
        });

        return {
          status: searchResult.status,
          count: searchResult.listings.length,
          candidateCount: searchResult.candidateCount,
          rankedCount: searchResult.rankedCount,
          searchState: searchResult.searchState,
          listings: searchResult.listings.map(getRankedListingSearchSummary),
          recommendations: searchResult.recommendations,
          market: searchResult.market,
          relaxedSuggestion: searchResult.relaxedSuggestion,
          note:
            'Search state is accumulated on the server. Return only the visible ranked matches and explain scores using the provided reasons. Do not invent unavailable listings or market averages.',
        };
      },
    }),

    compareMarketplaceListings: tool({
      description:
        'Compare one specific published listing against similar SmartStore AI marketplace listings. Use this when the user asks to compare a selected listing, especially if a listingId is provided. Return the target listing and comparable alternatives from real marketplace data only.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        query: z.string().trim().min(1).max(300).optional(),
        limit: z.number().int().min(2).max(12).optional(),
      }),
      execute: async ({ listingId, query, limit = 8 }) => {
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
                terms: [targetListing.title ?? ''].filter(Boolean),
                limit: Math.max(limit + 24, 30),
              },
        );
        const comparison = compareListingsWithEngine(
          targetListing,
          listings,
          limit,
        );

        return {
          status: 'compared',
          target: getComparisonListingSummary(comparison.target),
          count: comparison.alternatives.length,
          listings: comparison.alternatives.map(getComparisonListingSummary),
          marketSummary: comparison.marketSummary,
          comparisonBasis:
            'Comparison scores and labels are computed from real SmartStore AI listing data. Explain these values; do not invent market averages or unavailable alternatives.',
        };
      },
    }),

    estimateListingPrice: tool({
      description:
        'Estimate an honest seller price range using real comparable SmartStore AI listings. Return a range, comparable count, confidence, and adjustments. Never present this as a guaranteed market price.',
      inputSchema: listingDetailsInputSchema,
      execute: async (input) => {
        const listingInput = normalizeListingDetailsInput(
          input,
        ) as CreateListingInput;
        const comparableListings = await listMarketplaceListings({
          category: listingInput.category,
          city: listingInput.city,
          terms: [
            listingInput.title ?? '',
            String(listingInput.attributes?.brand ?? ''),
            String(listingInput.attributes?.model ?? ''),
          ].filter(Boolean),
          limit: 80,
        });

        return recommendListingPrice(listingInput, comparableListings);
      },
    }),

    evaluateNegotiationOffer: tool({
      description:
        'Evaluate a buyer offer for a specific published listing using asking price and comparable SmartStore AI listings. This gives negotiation guidance only and never accepts, rejects, or commits to a deal.',
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
          terms: [listing.title ?? ''].filter(Boolean),
          limit: 80,
        });

        return {
          status: 'evaluated',
          advice: evaluateNegotiationOffer(
            listing,
            buyerOffer,
            comparableListings,
          ),
          note:
            'This is guidance only. Do not accept, reject, or commit to a deal without explicit user confirmation.',
        };
      },
    }),

    createListingDraft: tool({
      description:
        'Create a structured marketplace listing draft from a natural seller conversation. Use only after the user wants to sell or publish an allowed marketplace item. Include confirmed sale terms, usage notes, defects/no-defects, color, material, and brand when the seller provides them. Do not use for prohibited Saudi or Islamic-policy items.',
      inputSchema: listingDetailsInputSchema,
      execute: async (input) => {
        if (!session) {
          return authRequired();
        }

        const listingInput = normalizeListingDetailsInput(
          input,
        ) as CreateListingInput;
        let listing = await createListingDraft(session.user, listingInput);

        if (listing.compliance.decision === 'block') {
          return {
            status: 'blocked',
            message:
              'This listing is blocked by Saudi marketplace and Islamic compliance policy.',
            listing,
          };
        }

        if (options.latestUploadedImages?.length) {
          const listingText = buildListingText(listingInput);
          let imageCompliance: Awaited<
            ReturnType<typeof checkImageMarketplaceCompliance>
          >;

          try {
            imageCompliance = await checkImageMarketplaceCompliance({
              messages: buildImageReviewMessages(
                options.latestUploadedImages,
                listingText,
              ),
              userRequest: listingText,
              language: 'ar',
              expectedCategory: listingInput.category,
              listingText,
            });
          } catch {
            return {
              status: 'image_review_unavailable',
              message:
                'The draft was created, but the uploaded image could not be reviewed or saved. Do not publish until image review succeeds.',
              listing,
            };
          }

          if (imageCompliance.decision === 'block') {
            return {
              status: 'blocked',
              message:
                'The draft was created, but the uploaded image is blocked by Saudi marketplace and Islamic compliance policy. Do not publish.',
              listing,
              compliance: imageCompliance,
            };
          }

          if (imageCompliance.decision === 'needs_review') {
            return {
              status: 'needs_review',
              message:
                'The draft was created, but the uploaded image needs manual review before publishing.',
              listing,
              compliance: imageCompliance,
            };
          }

          const listingWithImages = await saveUploadedListingImagesForSeller({
            listingId: listing.id,
            sellerId: session.user.id,
            images: options.latestUploadedImages,
          });

          if (listingWithImages) {
            listing = listingWithImages;
          }
        }

        return {
          status: listing.status === 'pending' ? 'needs_review' : 'draft_created',
          message:
            listing.status === 'pending'
              ? 'Draft created for manual review. Do not publish directly.'
              : listing.images.some((image) => image.status === 'approved')
                ? 'Draft created with the uploaded product image. Ask for final confirmation before publishing.'
                : 'Draft created. Ask for missing details, images, and final confirmation before publishing.',
          listing,
        };
      },
    }),

    updateListing: tool({
      description:
        'Update a seller-owned listing after the user clearly requests a change. Requires Google sign-in. Preserve confirmed sale terms, usage notes, defects/no-defects, color, material, and brand as structured attributes. Price changes and destructive actions must be confirmed by the user before using this tool.',
      inputSchema: updateListingDetailsInputSchema,
      execute: async ({ listingId, ...updates }) => {
        if (!session) {
          return authRequired();
        }

        const listing = await updateListingForSeller(
          listingId,
          session.user.id,
          normalizeListingDetailsInput(updates),
        );

        if (!listing) {
          return {
            status: 'not_found',
            message: 'Listing was not found or is not owned by this user.',
          };
        }

        if (listing.compliance.decision === 'block') {
          return {
            status: 'blocked',
            message:
              'This update is blocked by Saudi marketplace and Islamic compliance policy.',
            listing,
          };
        }

        return {
          status: listing.status === 'pending' ? 'needs_review' : 'updated',
          listing,
        };
      },
    }),

    setListingStatus: tool({
      description:
        'Publish, pause, mark sold, or delete a seller-owned listing. Use only after explicit user confirmation for the selected listing.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        status: z.enum(['published', 'paused', 'sold', 'deleted']),
      }),
      execute: async ({ listingId, status }) => {
        if (!session) {
          return authRequired();
        }

        const listing = await setListingStatusForSeller(
          listingId,
          session.user.id,
          status,
        );

        if (!listing) {
          return {
            status: 'not_found',
            message: 'Listing was not found or is not owned by this user.',
          };
        }

        return {
          status: listing.status,
          listing,
        };
      },
    }),

    analyzeListingImages: tool({
      description:
        'Evaluate listing image quality and truth-preserving enhancement actions. Images are uploaded through chat; do not recommend edits that hide defects or change the item.',
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
          .max(10),
      }),
      execute: async ({ images }) => ({
        status: 'analyzed',
        policy:
          'Allowed enhancements: crop, lighting, sharpening, straighten, compression, thumbnails, and blur sensitive info. Forbidden: hide defects, change colors, add accessories, or alter product truth.',
        results: images.map(analyzeImageQuality),
      }),
    }),

    openMarketplaceConversation: tool({
      description:
        'Open an internal buyer-seller conversation for a published listing. Requires Google sign-in and must not expose phone numbers.',
      inputSchema: z.object({
        listingId: z.string().min(1),
      }),
      execute: async ({ listingId }) => {
        if (!session) {
          return authRequired();
        }

        return createConversationForListing(listingId, session.user);
      },
    }),

    toggleFavoriteListing: tool({
      description:
        'Save or remove a published listing from the current user favorites. Requires Google sign-in.',
      inputSchema: z.object({
        listingId: z.string().min(1),
      }),
      execute: async ({ listingId }) => {
        if (!session) {
          return authRequired();
        }

        return toggleFavoriteListing(listingId, session.user);
      },
    }),

    reportMarketplaceListing: tool({
      description:
        'Report a published listing for moderation review when the user says it is prohibited, fraudulent, counterfeit, misleading, abusive, or in the wrong category. Requires Google sign-in.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        reason: z.enum([
          'prohibited_item',
          'fraud',
          'counterfeit',
          'wrong_category',
          'misleading_images',
          'abusive_content',
          'other',
        ]),
        details: z.string().min(2).max(1000).optional(),
      }),
      execute: async ({ listingId, reason, details }) => {
        if (!session) {
          return authRequired();
        }

        return reportListing(listingId, session.user, reason, details);
      },
    }),
  };
}
