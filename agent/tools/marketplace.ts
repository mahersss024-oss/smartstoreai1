import { marketplaceAmountSchema } from '@/lib/marketplace/amounts';
import { tool } from 'ai';
import sharp from 'sharp';
import { marketplaceCategoryIds, marketplaceCategoryPrompt } from '@/lib/marketplace/categories';
import { InvalidMarketplaceCategoryOptionError, marketplaceCategoryOptionAttribute, marketplaceCategoryOptionsPrompt } from '@/lib/marketplace/category-options';
import { marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';
import { z } from 'zod';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { reviewListingImageContent } from '@/agent/marketplace/listing-image-content';
import {
  getChatListingImageId,
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
  listSellerListings,
  updateListingForSeller,
  type CreateListingInput,
} from '@/agent/marketplace/repository';
import type { AuthSession } from '@/lib/auth/session';
import type { AppLanguage } from '@/app/i18n';
import { chatDraftOperationKey, type ChatDraftReceipt } from '@/lib/chat/draft-receipt';
import { filterDraftEdits, type ChatDraftAction } from '@/lib/chat/draft-edits';
import { getPlatformHelp, platformHelpTopics } from '@/agent/platform-guide';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';

function authRequired() {
  return {
    status: 'auth_required' as const,
    message:
      'Sign-in with Google or Apple is required before using Hamad chat or account-bound marketplace actions.',
  };
}

const listingDetailsSchema = {
  autoCategory: z.boolean().optional().describe('Use true only when the seller has not explicitly selected a category; infer from title and description if possible. Preserve an explicit seller category.'),
  category: z.enum(marketplaceCategoryIds).describe(`Marketplace category ID: ${marketplaceCategoryPrompt}. Preserve an explicit seller category.`),
  categoryOption: z.string().max(80).nullable().optional().describe(`One optional brand/type ID belonging to the selected category, never a model or detailed variant. Use only a seller-confirmed or unambiguous value, omit when unknown; null clears it. Catalog:\n${marketplaceCategoryOptionsPrompt}`),
  carModel: z.string().max(80).nullable().optional().describe('Cars only: exact model-family ID under the selected categoryOption brand from the system catalog. Omit when unknown; null clears it. Never years or trim levels.'),
  title: z.string().min(2).optional(),
  description: z.string().min(2)
    .describe('Customer-facing product description using only seller-confirmed facts. Omit unknown details; never narrate missing or unprovided specifications in the description.')
    .optional(),
  price: z
    .union([marketplaceAmountSchema, z.enum(['bid', 'negotiable'])])
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

export const listingDetailsInputSchema = z.object(listingDetailsSchema);
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
    categoryOption,
    carModel,
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
      ...(categoryOption !== undefined ? { [marketplaceCategoryOptionAttribute]: categoryOption } : {}),
      ...(carModel !== undefined ? { [marketplaceCarModelAttribute]: carModel } : {}),
    },
  };
}

function confirmationRequired(message: string) {
  return {
    status: 'needs_confirmation' as const,
    message,
  };
}

function confirmSelectedDraftPhotos(
  listing: Awaited<ReturnType<typeof createListingDraft>>,
  selected: UploadedListingImage[],
  previousImageIds: ReadonlySet<string>,
) {
  const requested = new Set(selected.map(image => getChatListingImageId(listing.id, image)));
  const attached = listing.images.map(image => image.id).filter(id => requested.has(id));
  const added = attached.filter(id => !previousImageIds.has(id));
  return {
    requestedImageCount: requested.size,
    attachedImageCount: attached.length,
    addedImageCount: added.length,
    receipt: { requested: [...requested], attached, added },
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

  const drafts = (await listSellerListings(sellerId)).filter(listing => listing.status === 'draft');
  return drafts.length === 1 ? drafts[0] : null;
}

export function createMarketplaceTools(
  session: AuthSession | null,
  options: {
    latestUploadedImages?: UploadedListingImage[];
    imageSourceMessageId?: string;
    language?: AppLanguage;
    requestKey?: string;
    draftAction?: ChatDraftAction;
    onDraftReceipt?: (receipt: ChatDraftReceipt) => void;
  } = {},
) {
  const draftOperations = new Map<string, number>();
  const createdDraftsByProduct = new Map<string, Awaited<ReturnType<typeof createListingDraft>>>();
  const draftsCreatedThisTurn = new Set<string>();
  const imageOwners = new Map<number, string>();
  const { draftAction } = options;
  let pendingWrite = Promise.resolve();
  function writeInOrder<T>(signal: AbortSignal | undefined, run: () => Promise<T>) {
    const result = pendingWrite.then(() => {
      signal?.throwIfAborted();
      return run();
    });
    pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }
  function canEditDraft(listingId: string | undefined) {
    if (!draftAction) return true;
    if (draftAction.intent === 'update') return listingId === draftAction.listingId;
    return listingId !== undefined && draftsCreatedThisTurn.has(listingId);
  }
  function selectUploadedImages(input: z.infer<typeof createDraftInputSchema> | { imageIndexes?: number[]; imageSourceMessageId?: string }) {
    const indexes = [...new Set(input.imageIndexes ?? [])];
    if (indexes.length && ((options.imageSourceMessageId && input.imageSourceMessageId !== options.imageSourceMessageId)
      || indexes.some(index => !options.latestUploadedImages?.[index]))) return null;
    return indexes.map(index => ({ index, image: options.latestUploadedImages![index] }));
  }
  const tools = {
    ...createReadOnlyMarketplaceTools(),
    createListingDraft: tool({
      description:
        'Create an owned unpublished marketplace draft from a natural seller conversation with a minimum product signal. Preserve confirmed details in title, description, price, city, condition, category and attributes, including model, year, mileage, specs, accessories, warranty, defects, color, material, brand, sale terms and seller notes. Omit unknown specifications and attributes; never put meta notes about missing seller details in listing fields. After a successful result the draft is already saved: do not ask the seller to create it again or call this tool again for the same product. Use updateListing with the saved listingId for later details; create another draft only for a different product or an explicit request for a separate ad. Automated policy concerns are advisory administration alerts, not authority to reject customer content. Respect explicit human moderation and technical permissions.',
      inputSchema: createDraftInputSchema,
      execute: (input, context) => writeInOrder(context?.abortSignal, async () => {
        if (!session) {
          return authRequired();
        }

        if (draftAction?.intent === 'update') {
          return confirmationRequired('This request is for an existing draft. Update the confirmed draft only.');
        }

        const selection = selectUploadedImages(createDraftInputSchema.parse(input));
        if (!selection) return { status: 'invalid_image_selection', message: 'Choose only indexes from the exact available image source; no draft or photos were saved.' };
        const listingInput = normalizeListingDetailsInput(
          listingDetailsInputSchema.parse(input),
        ) as CreateListingInput;
        if (!listingInput.title?.trim() && !listingInput.description?.trim()) {
          return { status: 'missing_product_details', message: 'Ask what product or service the seller wants to list. A category, city or price alone is not enough to save a draft.' };
        }
        const productIdentity = listingInput.title
          ? JSON.stringify([listingInput.category, normalizeMarketplaceSearchText(listingInput.title)])
          : undefined;
        const alreadyCreated = productIdentity ? createdDraftsByProduct.get(productIdentity) : undefined;
        if (alreadyCreated) {
          return {
            status: 'already_saved',
            listing: alreadyCreated,
            message: 'This product draft is already saved in this chat turn. Do not create it again. Use updateListing with this listingId to add confirmed details, or add explicitly selected new photos with addUploadedImagesToListing. Create a separate draft only for a different product explicitly requested by the seller.',
          };
        }
        let listing: Awaited<ReturnType<typeof createListingDraft>>;
        try {
          const signature = JSON.stringify({ ...listingInput, imageIndexes: input.imageIndexes, imageSourceMessageId: input.imageSourceMessageId }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
          const operationIndex = draftOperations.get(signature) ?? draftOperations.size;
          draftOperations.set(signature, operationIndex);
          const idempotencyKey = options.requestKey
            ? chatDraftOperationKey(session.user.id, options.requestKey, operationIndex) : undefined;
          listing = await createListingDraft(session.user, listingInput, { idempotencyKey, modelReview: true });
          const savedProduct = normalizeMarketplaceSearchText(listing.title || listing.description || '');
          const requestedProduct = normalizeMarketplaceSearchText(listingInput.title || listingInput.description || '');
          if (savedProduct !== requestedProduct || (!listingInput.autoCategory && listingInput.category !== listing.category)) {
            options.onDraftReceipt?.({ kind: 'replay_conflict', listing });
            return {
              status: 'already_saved',
              listing,
              message: 'A prior attempt for this turn saved a draft. Its product or category differs from the current tool request. No new listing or photos were saved by this call. Report the actual saved draft and ask the seller to review it before retrying.',
            };
          }
          if (listing.status === 'draft' || listing.status === 'pending') {
            draftsCreatedThisTurn.add(listing.id);
            const { price, city, condition, category, description } = listing;
            options.onDraftReceipt?.({ kind: 'saved', listing, facts: { price, city, condition, category, description } });
          }
        } catch (error) {
          if (error instanceof InvalidMarketplaceCategoryOptionError) return { status: 'invalid_category_option', message: error.message };
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

        if (listing.compliance.humanDecision === 'block') {
          options.onDraftReceipt?.({ kind: 'blocked', listing });
          return {
            status: 'blocked',
            message:
              'An explicit administration decision restricts this listing. Do not bypass it.',
            listing,
          };
        }
        if (listing.status !== 'draft' && listing.status !== 'pending') {
          options.onDraftReceipt?.({ kind: 'replayed', listing });
          return {
            status: 'already_saved', listing,
            message: 'This request already saved the listing. Do not create another or modify its current state; guide the user to Account > My listings.',
          };
        }

        const imageSelectionConflict = selection.some(({ index }) => imageOwners.has(index) && imageOwners.get(index) !== listing.id);
        const images = selection.map(({ image }) => image);
        const previousImageIds = new Set(listing.images.map(image => image.id));
        if (selection.length && !imageSelectionConflict) {
          context?.abortSignal?.throwIfAborted();
          selection.forEach(({ index }) => imageOwners.set(index, listing.id));
          const review = await reviewListingImageContent(images, listing.images, { listingId: listing.id, userId: session.user.id });
          const listingWithImages = await saveUploadedListingImagesForSeller({
            listingId: listing.id,
            sellerId: session.user.id,
            images,
            contentReviewStatuses: review.imageReviewStatuses,
            draftOnly: true,
          }).catch((error: unknown) => {
            console.warn(`[draft_image_upload] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
            return null;
          });

          if (listingWithImages) {
            listing = listingWithImages;
          }
        }

        if (productIdentity && (listing.status === 'draft' || listing.status === 'pending')) {
          createdDraftsByProduct.set(productIdentity, listing);
        }

        const { receipt, ...photos } = confirmSelectedDraftPhotos(listing, images, previousImageIds);
        if (photos.requestedImageCount) options.onDraftReceipt?.({ kind: 'photos', listing, photos: receipt });
        return {
          status: listing.status === 'pending' ? 'needs_review' : 'draft_created',
          imageSelectionConflict,
          ...photos,
          message:
            listing.status === 'pending'
              ? 'Draft created for manual review. Do not publish directly.'
              : imageSelectionConflict
                ? 'Draft created without photos: selected photos already belong to another product draft in this turn. Ask which remaining photos belong to this product; never copy unrelated photos.'
                : photos.attachedImageCount < photos.requestedImageCount
                ? 'Draft created. Some photos could not be saved, but photos are optional and the seller can publish manually from Account > My listings.'
                : photos.attachedImageCount
                ? 'Draft created with the uploaded product image. The seller must review and publish it from Account > My listings.'
                : 'Draft created. Photos are optional. Ask about useful missing details separately in chat; do not put notes about missing details in listing fields. Direct the seller to Account > My listings when they want to publish.',
          listing,
        };
      }),
    }),

    updateListing: tool({
      description:
        'Prepare details of an owned unpublished draft only. Never edit published, paused, sold, pending-review or deleted listings; direct the seller to Account > My listings for those changes. Send only the fields the customer asked to change; preserve all other details. Ask follow-up questions separately in chat. Use the server-confirmed listingId or the listingId returned by draft creation in this turn. The server verifies the exact requested amount before accepting a price change.',
      inputSchema: updateListingDetailsInputSchema,
      execute: (input, context) => writeInOrder(context?.abortSignal, async () => {
        if (!session) {
          return authRequired();
        }

        const { listingId, confirmedPriceChange, ...proposedUpdates } = updateListingDetailsInputSchema.parse(input);
        const confirmedId = listingId ?? (draftAction?.intent === 'update' ? draftAction.listingId : undefined);
        if (!canEditDraft(confirmedId)) {
          return confirmationRequired('Use only the draft confirmed for this request or created in this chat turn.');
        }

        const updates = draftAction?.edits ? filterDraftEdits(proposedUpdates, draftAction.edits) : proposedUpdates;
        if (!draftAction?.edits && updates.price !== undefined && confirmedPriceChange !== true) {
          return confirmationRequired(
            'Confirm the price change explicitly before updating the listing price.',
          );
        }
        if (!Object.keys(updates).length) {
          return {
            status: proposedUpdates.price !== undefined ? 'price_not_authorized' : 'missing_update_details',
            message: 'Ask only for the intended change or exact price still needed. No changes were saved by this call.',
          };
        }

        const targetListing = await getCurrentEditableSellerListing({
          sellerId: session.user.id,
          listingId: confirmedId,
        });

        if (!targetListing) {
          return {
            status: 'not_found',
            message: 'No single editable draft was found. Ask the seller to identify the draft they want to edit.',
          };
        }

        if (targetListing.status !== 'draft') {
          return { status: 'user_action_required', message: 'Only unpublished drafts can be prepared in chat. Review and edit this listing yourself from Account > My listings.' };
        }

        const listing = await updateListingForSeller(
          targetListing.id,
          session.user.id,
          normalizeListingDetailsInput(updates),
          { draftOnly: true, modelReview: true },
        ).catch((error: unknown) => {
          if (error instanceof InvalidMarketplaceCategoryOptionError) return error;
          throw error;
        });
        if (listing instanceof InvalidMarketplaceCategoryOptionError) return { status: 'invalid_category_option', message: listing.message };

        if (!listing) {
          return {
            status: 'not_found',
            message: 'Listing was not found or is not owned by this user.',
          };
        }

        if (listing.compliance.humanDecision === 'block') {
          options.onDraftReceipt?.({ kind: 'blocked', listing });
          return {
            status: 'blocked',
            message:
              'An explicit administration decision restricts this listing. Do not bypass it.',
            listing,
          };
        }

        const changes = Object.fromEntries(
          Object.keys(updates).map(field => [field, field === 'attributes'
            ? Object.fromEntries(Object.keys(updates.attributes ?? {}).map(key => [key, listing.attributes[key]]))
            : field === 'categoryOption' ? listing.attributes[marketplaceCategoryOptionAttribute] ?? null
              : field === 'carModel' ? listing.attributes[marketplaceCarModelAttribute] ?? null
                : field in listing ? listing[field as keyof typeof listing] : listing.attributes[field]]),
        );
        options.onDraftReceipt?.({ kind: 'updated', listing, changes });
        return {
          status: listing.status === 'pending' ? 'needs_review' : 'updated',
          listing,
        };
      }),
    }),

    addUploadedImagesToListing: tool({
      description:
        'Prepare uploaded chat images on an owned unpublished draft only. Requires sign-in and a clear listingId. Never change images on published, paused, sold, pending-review or deleted listings; direct the seller to Account > My listings.',
      inputSchema: z.object({
        listingId: z.string().min(1),
        ...uploadedImageSelection,
      }),
      execute: ({ listingId, ...selectionInput }, context) => writeInOrder(context?.abortSignal, async () => {
        if (!session) {
          return authRequired();
        }
        if (!canEditDraft(listingId)) {
          return confirmationRequired('Attach photos only to the draft confirmed for this request or created in this chat turn.');
        }

        if ((draftAction?.edits && !draftAction.edits.photos) || !options.latestUploadedImages?.length) {
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
        const previousImageIds = new Set(targetListing.images.map(image => image.id));
        const review = await reviewListingImageContent(images, targetListing.images, { listingId, userId: session.user.id });
        context?.abortSignal?.throwIfAborted();
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

        const { receipt, ...photos } = confirmSelectedDraftPhotos(listing, images, previousImageIds);
        options.onDraftReceipt?.({ kind: 'photos', listing, photos: receipt });
        const status = photos.attachedImageCount === 0 ? 'images_not_added'
          : photos.attachedImageCount < photos.requestedImageCount ? 'images_partially_added'
          : photos.addedImageCount ? 'images_added' : 'images_already_attached';
        return {
          status,
          ...photos,
          contentCheck: review.status,
          listing,
        };
      }),
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

export function createReadOnlyMarketplaceTools() {
  return {
    getPlatformHelp: tool({
      description: 'Read the documented public platform workflow or published policy. Use this before answering questions about platform usage, policies, fees, account deletion or terms. This does not retrieve products, account data, payments or private records and performs no actions.',
      inputSchema: z.object({ topic: z.enum(platformHelpTopics) }),
      execute: async ({ topic }) => getPlatformHelp(topic),
    }),
  };
}
