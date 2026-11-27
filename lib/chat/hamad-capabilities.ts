import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { getListing, listSellerListings } from '@/agent/marketplace/repository';
import { reviewListingImageContent } from '@/agent/marketplace/listing-image-content';
import { getS3ObjectStorageConfig } from '@/agent/marketplace/object-storage';
import type { UploadedListingImage } from '@/agent/marketplace/listing-image-storage';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { platformHelpTopics } from '@/agent/platform-guide';
import { marketplaceCategoryDefinitions } from '@/lib/marketplace/categories';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import type { AuthSession } from '@/lib/auth/session';
import { createListingId } from '@/lib/marketplace/listing-id';
import { chatDraftOperationKey, type ChatDraftReceipt } from './draft-receipt';
import type { DraftEdits } from './draft-edits';
import { modelReviewImageFingerprint, recordModelReview } from '@/lib/admin/model-review';
import { readHamadKnowledge } from './hamad-knowledge';
import { hamadDetails } from './hamad-structured-model';
import { hamadDraftRef } from './hamad-structured-state';

type CapabilityContext = {
  session: AuthSession;
  trace: string;
  signal: AbortSignal;
  operationKey?: string;
  images: readonly UploadedListingImage[];
  sourceId?: string;
};
type Draft = NonNullable<Awaited<ReturnType<typeof getListing>>>;
const draftDetails = z.object({
  title: z.string(), description: z.string().nullable(), category: z.string(), price: z.union([z.number(), z.string()]).nullable(),
  city: z.string().nullable(), status: z.literal('draft'), modified: z.string(), imageCount: z.number().int(),
});
const thumbnailPart = z.object({ url: z.string(), mediaType: z.literal('image/webp') });
const ownedDraft = z.object({ ref: hamadDraftRef, data: draftDetails, preview: thumbnailPart.optional() });
const listResult = z.object({ offset: z.number().int(), rosterHash: z.string(), hasNext: z.boolean(), entries: z.array(ownedDraft).max(4) });
const writeResult = z.object({
  status: z.string(),
  focus: hamadDraftRef.optional(),
  receipts: z.array(z.object({ kind: z.string(), title: z.string(), status: z.string(),
    facts: z.record(z.string(), z.unknown()).optional() })),
});
const existingToolResult = z.object({ status: z.string() });
export const structuredWriteResultSchema = writeResult;
type InputShape = z.infer<typeof hamadDetails>;

function register<I extends z.ZodType, O extends z.ZodType>(
  name: string, description: string, input: I, output: O,
  sideEffect: 'read' | 'draft-write', timeoutMs: number,
  execute: (args: z.output<I>, context: CapabilityContext) => unknown | Promise<unknown>,
) {
  const policy = {
    name, description, version: 1, enabled: true, sideEffect, timeoutMs,
    permission: 'verified chat session; draft queries and writes constrained to the authenticated owner',
    idempotency: sideEffect === 'draft-write' ? 'server turn reservation and repository write protections' : 'read only',
    audit: 'correlation ID, capability, status and duration only',
  };
  return {
    ...policy, input, output,
    async run(context: CapabilityContext, value: z.input<I>): Promise<z.output<O>> {
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]);
      signal.throwIfAborted();
      if (!context.session.user.id || context.session.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('hamad_auth_required');
      if (sideEffect === 'draft-write' && !context.operationKey) throw new Error('hamad_write_reservation_required');
      const started = performance.now();
      let status = 'failed';
      try {
        const result = await execute(input.parse(value), { ...context, signal });
        if (sideEffect === 'read') signal.throwIfAborted();
        const checked = output.parse(result);
        status = 'completed';
        return checked;
      } finally {
        if (process.env.SMARTSTORE_DEEPSEEK_METRICS === '1') console.info(JSON.stringify({
          event: 'hamad_capability', trace: context.trace, name, status, elapsedMs: Math.round(performance.now() - started),
        }));
      }
    },
  };
}

function safeText(text: string | null | undefined, length: number) {
  // Listing data can be rendered into chat text. It stays plain text and cannot inject a link or newline.
  return text?.replace(/https?:\/\/[^\s<>]+/giu, ' ').replace(/[\p{Cc}\p{Cf}\[\]<>]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, length) ?? '';
}
function publicThumbnail(record: Draft) {
  const thumbnail = record.images.find(({ status, thumbnailUrl }) => status === 'approved' && thumbnailUrl)?.thumbnailUrl;
  if (!thumbnail) return undefined;
  if (process.env.NODE_ENV !== 'production' && thumbnail.length <= 96_000 &&
      /^data:image\/webp;base64,[a-zA-Z0-9+/]+={0,2}$/u.test(thumbnail)) return { url: thumbnail, mediaType: 'image/webp' as const };
  try {
    const base = new URL(getS3ObjectStorageConfig().publicUrl ?? '');
    const url = new URL(thumbnail);
    const prefix = base.pathname.replace(/\/$/u, '') + '/listings/';
    if (base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash &&
        url.origin === base.origin && !url.username && !url.password && !url.search && !url.hash &&
        url.pathname.startsWith(prefix) && /[/-]thumbnail\.webp$/u.test(url.pathname)) {
      return { url: url.href, mediaType: 'image/webp' as const };
    }
  } catch {
    // Missing or non-CDN images still leave an actionable text entry.
  }
}
function display(record: Draft) {
  return {
    ref: { id: record.id, version: record.updatedAt },
    data: { title: safeText(record.title, 120), description: safeText(record.description, 1_400) || null,
      category: record.category, price: record.price ?? null, city: safeText(record.city, 80) || null,
      status: 'draft' as const, modified: record.updatedAt, imageCount: record.images.length },
    preview: publicThumbnail(record),
  };
}
function isOwnedDraft(listing: Draft | null | undefined, context: CapabilityContext): listing is Draft {
  return listing?.sellerId === context.session.user.id && listing.status === 'draft' && listing.compliance.humanDecision !== 'block';
}

async function ownedDraftRecord(id: string, context: CapabilityContext) {
  const listing = await getListing(id);
  return isOwnedDraft(listing, context) ? listing : null;
}

const empty = z.object({}).strict();
const photoIndexes = z.array(z.number().int().nonnegative().max(7)).max(8);
async function isReadableChatImage(image: UploadedListingImage | undefined) {
  if (!image) return false;
  try {
    const info = await sharp(image.data, { animated: true, failOn: 'warning', limitInputPixels: 45_000_000 }).metadata();
    return 'image/' + info.format === image.mediaType && Boolean(info.width && info.height) && (info.pages ?? 1) === 1;
  } catch {
    return false;
  }
}
function makeWriteTools(context: CapabilityContext, input: { focus?: z.infer<typeof hamadDraftRef>; edits?: DraftEdits }) {
  const events: ChatDraftReceipt[] = [];
  const tools = createMarketplaceTools(context.session, {
    draftAction: input.focus ? { intent: 'update', listingId: input.focus.id, edits: input.edits }
      : { intent: 'create' },
    latestUploadedImages: [...context.images],
    imageSourceMessageId: context.sourceId,
    requestKey: context.operationKey,
    onDraftReceipt: (receipt) => events.push(receipt),
  });
  const toolContext = { toolCallId: context.trace, messages: [], abortSignal: context.signal, context: {} };
  async function finish(status: string, committed?: Draft) {
    const receipts = events.map((entry) => ({
      kind: entry.kind, title: safeText(entry.listing.title, 120), status: entry.listing.status,
      facts: entry.kind === 'updated' ? entry.changes : entry.kind === 'saved' ? entry.facts
        : entry.kind === 'photos' ? { attached: entry.photos.attached.length, requested: entry.photos.requested.length, added: entry.photos.added.length } : undefined,
    }));
    // The tool receipt already contains the committed record. Reads for the
    // displayed preview and subsequent edits still verify its current state.
    const last = events.at(-1)?.listing;
    const draft = last && (committed?.id === last.id ? committed : await ownedDraftRecord(last.id, context));
    return { status, receipts, ...(isOwnedDraft(draft, context) ? { focus: display(draft).ref } : {}) };
  }
  return { tools, toolContext, finish };
}

export async function findDraftSavedByHamadTurn(sellerId: string, operationKey: string) {
  // A structured turn dispatches only one create call. Match the write's first operation.
  const key = chatDraftOperationKey(sellerId, operationKey, 0);
  const listing = await getListing(createListingId(sellerId, key)) ?? await getListing('chat-draft-' + key);
  return listing?.sellerId === sellerId ? listing : null;
}

export const hamadCapabilities = {
  list_my_drafts: register('list_my_drafts', 'Find the signed-in seller’s own draft page.',
    z.object({ offset: z.number().int().min(0).max(10_000) }).strict(), listResult, 'read', 5_000,
    async ({ offset }, context) => {
      const records = (await listSellerListings(context.session.user.id))
        .filter((item) => item.sellerId === context.session.user.id && item.status === 'draft' && item.compliance.humanDecision !== 'block')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const rosterHash = createHash('sha256').update(JSON.stringify(records.map(({ id, updatedAt }) => [id, updatedAt]))).digest('hex');
      return { entries: records.slice(offset, offset + 4).map(display), rosterHash, offset, hasNext: offset + 4 < records.length };
    }),
  get_draft: register('get_draft', 'Read the selected owned draft using a server checkpoint.',
    hamadDraftRef, ownedDraft.nullable(), 'read', 5_000, async ({ id }, context) => {
      const draft = await ownedDraftRecord(id, context);
      return draft ? display(draft) : null;
    }),
  create_draft: register('create_draft', 'Save one owned unpublished draft using verified customer data.',
    z.object({ details: hamadDetails.required({ category: true }), photos: photoIndexes }).strict(), writeResult, 'draft-write', 35_000,
    async ({ details, photos }, context) => {
      const { tools, toolContext, finish } = makeWriteTools(context, {});
      const result = await tools.createListingDraft.execute({ ...details, imageIndexes: photos,
        imageSourceMessageId: context.sourceId }, toolContext);
      return finish(existingToolResult.parse(result).status, 'listing' in result ? result.listing : undefined);
    }),
  update_draft: register('update_draft', 'Write only verified fields to the selected, revalidated owned draft.',
    z.object({ focus: hamadDraftRef, details: hamadDetails, evidence: z.record(z.string(), z.string()) }).strict(),
    writeResult, 'draft-write', 30_000, async ({ focus, details, evidence }, context) => {
      const current = await ownedDraftRecord(focus.id, context);
      if (!current || current.updatedAt !== focus.version) return { status: 'draft_changed', receipts: [] };
      const fields: DraftEdits['fields'] = Object.fromEntries(Object.entries(details)
        .filter(([key]) => key !== 'price')
        .map(([key]) => [key, normalizeMarketplaceSearchText(evidence[key] ?? '')]));
      const { tools, toolContext, finish } = makeWriteTools(context, {
        focus, edits: { fields, price: details.price, photos: false },
      });
      const result = await tools.updateListing.execute({ ...details, listingId: focus.id }, toolContext);
      return finish(existingToolResult.parse(result).status);
    }),
  attach_draft_images: register('attach_draft_images', 'Attach validated uploaded photos to the current owned draft.',
    z.object({ focus: hamadDraftRef, photos: photoIndexes.min(1) }).strict(), writeResult, 'draft-write', 35_000,
    async ({ focus, photos }, context) => {
      const current = await ownedDraftRecord(focus.id, context);
      if (!current || current.updatedAt !== focus.version || !context.sourceId) return { status: 'draft_changed', receipts: [] };
      const { tools, toolContext, finish } = makeWriteTools(context, { focus, edits: { fields: {}, photos: true } });
      const result = await tools.addUploadedImagesToListing.execute({ listingId: focus.id, imageIndexes: photos, imageSourceMessageId: context.sourceId }, toolContext);
      return finish(existingToolResult.parse(result).status);
    }),
  get_categories: register('get_categories', 'Read the authoritative marketplace category catalog.',
    empty, z.array(z.object({ id: z.string(), label: z.string() })), 'read', 2_000, () => marketplaceCategoryDefinitions),
  get_platform_info: register('get_platform_info', 'Read versioned public platform documents.',
    z.object({ topic: z.enum(platformHelpTopics) }).strict(),
    z.object({ source_id: z.string(), version: z.string(), updated_at: z.string().nullable(),
      access_level: z.literal('public'), content: z.unknown() }),
    'read', 2_000, ({ topic }) => readHamadKnowledge(topic)),
  analyze_image: register('analyze_image', 'Inspect only the permitted images linked to this turn.',
    z.object({ photos: photoIndexes.min(1) }).strict(),
    z.object({ status: z.enum(['allowed', 'unavailable']), observations: z.array(z.object({ photo: z.number().int(),
      visibleProduct: z.string().nullable(), tentative: z.literal(true) })) }),
    'read', 30_000, async ({ photos }, context) => {
      const selected = photos.map((index) => context.images[index]);
      const readable = await Promise.all(selected.map(isReadableChatImage));
      if (!readable.every(Boolean)) return { status: 'unavailable', observations: [] };
      const review = await reviewListingImageContent(selected);
      await recordModelReview({
        subject: 'image', subjectId: 'assistant:' + modelReviewImageFingerprint(selected.map((image) => image.data)),
        userId: context.session.user.id, text: review.compliance?.detectedProduct ?? 'صورة مرفوعة للإعلان',
        assessment: { decision: review.compliance?.decision ?? 'needs_review',
          reasons: review.compliance?.reasons ?? ['image_inspection_unavailable'], unavailable: review.status === 'unavailable' },
      }).catch(() => console.warn('[hamad_structured] image_advisory_review_unavailable'));
      return {
        status: review.status,
        observations: (review.compliance?.imageProducts ?? []).map((item, index) => ({
          photo: photos[index] + 1, visibleProduct: safeText(item.detectedProduct, 90) || null, tentative: true,
        })),
      };
    }),
};

export type HamadStructuredDetails = InputShape;
