import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { UploadedListingImage } from '@/agent/marketplace/listing-image-storage';
import { getAuthSecret, type AuthSession } from '@/lib/auth/session';

const reference = z.string().min(1).max(200);
const sourceReference = z.object({ sourceId: reference, digest: z.string().regex(/^[a-f0-9]{64}$/) });
export const draftQuestionField = z.enum([
  'product', 'description', 'price', 'city', 'condition', 'specifications', 'bundle', 'photos', 'change', 'draft', 'category',
]);
export type DraftQuestionField = z.infer<typeof draftQuestionField>;

const taskSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('create') }),
  z.object({ intent: z.literal('update'), listingId: reference }),
]);
const stateSchema = z.object({
  focusedDraftId: reference.optional(),
  pending: z.object({
    field: draftQuestionField,
    task: taskSchema.optional(),
    image: sourceReference.optional(),
    request: sourceReference.optional(),
  }).optional(),
});
export type DraftMemory = z.infer<typeof stateSchema>;
export type DraftTask = z.infer<typeof taskSchema>;

const checkpointSchema = stateSchema.extend({
  owner: reference,
  version: z.number().int().nonnegative(),
  conversationId: reference,
  expiresAt: z.number().int(),
});
const checkpointLifetimeMs = 30 * 24 * 60 * 60 * 1000;

function signature(payload: string) {
  return createHmac('sha256', getAuthSecret()).update('souq-hamad.draft-memory.v1:').update(payload).digest();
}

export function signDraftMemory(state: DraftMemory, session: AuthSession, conversationId: string) {
  const payload = Buffer.from(JSON.stringify({
    ...state,
    owner: session.user.id,
    version: session.user.sessionVersion ?? 0,
    conversationId,
    expiresAt: Date.now() + checkpointLifetimeMs,
  })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function readDraftMemory(messages: readonly { role?: unknown; metadata?: unknown }[], session: AuthSession, conversationId: string | null) {
  if (!conversationId) return {};
  const latestUser = messages.findLastIndex(message => message.role === 'user');
  const latestAssistant = messages.findLastIndex((message, index) => index < latestUser && message.role === 'assistant');
  for (let index = latestAssistant; index >= 0; index--) {
    const message = messages[index];
    const metadata = message.metadata;
    if (message.role !== 'assistant' || typeof metadata !== 'object' || metadata === null || !('hamadDraftMemory' in metadata)) continue;
    const token = metadata.hamadDraftMemory;
    if (typeof token !== 'string' || token.length > 2_400 || !/^[\w-]+\.[\w-]{43}$/.test(token)) return {};
    try {
      const [payload, mac] = token.split('.');
      const supplied = Buffer.from(mac, 'base64url');
      if (supplied.length !== 32 || !timingSafeEqual(supplied, signature(payload))) return {};
      const result = checkpointSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      if (!result.success) return {};
      const { owner, version, conversationId: boundId, expiresAt, focusedDraftId, pending } = result.data;
      if (owner !== session.user.id || version !== (session.user.sessionVersion ?? 0) || boundId !== conversationId || expiresAt <= Date.now()) return {};
      return { focusedDraftId, pending: index === latestAssistant ? pending : undefined } satisfies DraftMemory;
    } catch {
      return {};
    }
  }
  return {};
}

export function draftImageSource(sourceId: string | undefined, images: readonly UploadedListingImage[]) {
  if (!sourceId || !images.length) return undefined;
  const digest = createHash('sha256');
  for (const image of images) {
    digest.update(`${image.mediaType}:${image.data.byteLength}:`).update(image.data);
  }
  return { sourceId, digest: digest.digest('hex') };
}

export function draftRequestSource(sourceId: string | undefined, request: string) {
  if (!sourceId || !request) return undefined;
  return { sourceId, digest: createHash('sha256').update(request).digest('hex') };
}
