import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getAuthSecret, type AuthSession } from '@/lib/auth/session';

export const hamadDraftRef = z.object({ id: z.string().min(1).max(200), version: z.string().min(1).max(64) }).strict();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const stateSchema = z.object({
  focus: hamadDraftRef.optional(),
  focusTitle: z.string().min(1).max(120).optional(),
  page: z.object({
    offset: z.number().int().nonnegative(),
    rosterHash: digest,
    entries: z.array(hamadDraftRef).max(4),
    hasNext: z.boolean(),
  }).optional(),
  collecting: z.string().min(1).max(200).optional(),
  image: z.object({ sourceId: z.string().min(1).max(200), digest }).optional(),
}).strict();
export type HamadStructuredState = z.infer<typeof stateSchema>;
export type HamadDraftRef = z.infer<typeof hamadDraftRef>;

const pageKey = z.string().regex(/^[a-f0-9]{64}:[0-9]{1,5}$/u);
export const hamadDraftActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list') }).strict(),
  z.object({ type: z.literal('next'), page: pageKey }).strict(),
  z.object({ type: z.literal('select'), page: pageKey, choice: z.number().int().min(1).max(4) }).strict(),
]);
export type HamadDraftAction = z.infer<typeof hamadDraftActionSchema>;

const checkpoint = stateSchema.extend({ expires: z.number().int() });
export const hamadDraftTtlMs = 20 * 60_000;
function key() {
  return createHmac('sha256', getAuthSecret()).update('souq-hamad.structured-checkpoint.v2').digest();
}
function associatedData(session: AuthSession, conversationId: string) {
  return Buffer.from(JSON.stringify([session.user.id, session.user.sessionVersion ?? 0, session.issuedAt, conversationId]));
}
function frameMac(payload: string) {
  return createHmac('sha256', key()).update('frame:').update(payload).digest();
}

export function sealHamadState(state: HamadStructuredState, session: AuthSession, conversationId: string | null) {
  if (!conversationId) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(associatedData(session, conversationId));
  const payload = Buffer.from(JSON.stringify(checkpoint.parse({ ...state, expires: Date.now() + hamadDraftTtlMs })));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const frame = 'h2_' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  // Already released clients retain only the historical payload.mac envelope in local history.
  const token = frame + '.' + frameMac(frame).toString('base64url');
  return token.length <= 2_400 ? token : undefined;
}

export function openHamadState(token: unknown, session: AuthSession, conversationId: string | null): HamadStructuredState {
  if (!conversationId || typeof token !== 'string' || token.length > 2_400 || !/^h2_[\w-]+\.[\w-]{43}$/u.test(token)) return {};
  try {
    const [frame, signature] = token.split('.');
    const mac = Buffer.from(signature, 'base64url');
    if (mac.length !== 32 || !timingSafeEqual(frameMac(frame), mac)) return {};
    const payload = Buffer.from(frame.slice(3), 'base64url');
    if (payload.length <= 28 || 'h2_' + payload.toString('base64url') !== frame) return {};
    const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, 12));
    decipher.setAAD(associatedData(session, conversationId));
    decipher.setAuthTag(payload.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
    const { expires, ...state } = checkpoint.parse(JSON.parse(plain.toString('utf8')));
    return expires > Date.now() ? state : {};
  } catch {
    return {};
  }
}
