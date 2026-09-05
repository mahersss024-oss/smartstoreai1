import { tool } from 'ai';
import { z } from 'zod';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import {
  createConversationForListing,
  createListingDraft,
  listMarketplaceListings,
  reportListing,
  setListingStatusForSeller,
  toggleFavoriteListing,
  updateListingForSeller,
} from '@/agent/marketplace/repository';
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
    image:
      primaryImage?.thumbnailUrl ??
      primaryImage?.displayUrl ??
      primaryImage?.originalUrl,
    views: listing.views,
    messageCount: listing.messageCount,
    favoriteCount: listing.favoriteCount,
  };
}

export function createMarketplaceTools(session: AuthSession | null) {
  return {
    searchMarketplaceListings: tool({
      description:
        'Search current published SmartStore AI marketplace listings for a buyer. Use this before saying listings are unavailable. This is read-only and never stores the user search terms.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(300).optional(),
      }),
      execute: async ({ query }) => {
        const listings = await listMarketplaceListings({ query });

        return {
          status: 'searched',
          count: listings.length,
          listings: listings.slice(0, 8).map(getListingSearchSummary),
          note:
            'Search words such as أبحث or أريد are treated as intent only, not stored as listing data.',
        };
      },
    }),

    createListingDraft: tool({
      description:
        'Create a structured marketplace listing draft from a natural seller conversation. Use only after the user wants to sell or publish an allowed marketplace item. Do not use for prohibited Saudi or Islamic-policy items.',
      inputSchema: z.object({
        category: z.string().min(2),
        title: z.string().min(2).optional(),
        description: z.string().min(2).optional(),
        price: z
          .union([z.number().nonnegative(), z.enum(['bid', 'negotiable'])])
          .optional(),
        city: z.string().min(2).optional(),
        condition: z
          .enum(['new', 'used', 'like_new', 'damaged'])
          .optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async (input) => {
        if (!session) {
          return authRequired();
        }

        const listing = await createListingDraft(session.user, input);

        if (listing.compliance.decision === 'block') {
          return {
            status: 'blocked',
            message:
              'This listing is blocked by Saudi marketplace and Islamic compliance policy.',
            listing,
          };
        }

        return {
          status: listing.status === 'pending' ? 'needs_review' : 'draft_created',
          message:
            listing.status === 'pending'
              ? 'Draft created for manual review. Do not publish directly.'
              : 'Draft created. Ask for missing details, images, and final confirmation before publishing.',
          listing,
        };
      },
    }),

    updateListing: tool({
      description:
        'Update a seller-owned listing after the user clearly requests a change. Requires Google sign-in. Price changes and destructive actions must be confirmed by the user before using this tool.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        title: z.string().min(2).optional(),
        description: z.string().min(2).optional(),
        price: z
          .union([z.number().nonnegative(), z.enum(['bid', 'negotiable'])])
          .optional(),
        city: z.string().min(2).optional(),
        category: z.string().min(2).optional(),
        condition: z
          .enum(['new', 'used', 'like_new', 'damaged'])
          .optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ listingId, ...updates }) => {
        if (!session) {
          return authRequired();
        }

        const listing = await updateListingForSeller(
          listingId,
          session.user.id,
          updates,
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
