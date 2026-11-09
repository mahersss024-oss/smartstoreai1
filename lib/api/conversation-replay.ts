import { getConversationBlockStatus, getConversationForUser } from '@/agent/marketplace/repository';
import type { reserveIdempotencyKey } from './idempotency';
import { noStoreHeaders } from './no-store';

type Reservation = NonNullable<Awaited<ReturnType<typeof reserveIdempotencyKey>>>;
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Keep an operation receipt, never a second copy of private message content. */
export async function completeConversationResponse(reservation: Reservation | null, body: unknown, status = 200) {
  if (reservation && object(body)) {
    const receipt = { ...body };
    if (object(receipt.conversation)) receipt.conversation = { id: receipt.conversation.id };
    if (object(receipt.message)) receipt.message = { id: receipt.message.id };
    await reservation.complete(receipt, status);
  }
  return Response.json(body, { status, headers: noStoreHeaders });
}

/** Re-authorize both new reference receipts and historical snapshot receipts.
 * Deletion for everyone/for me and account access always use current rows. */
export async function replayConversationResponse(response: Response, userId: string, conversationId?: string) {
  const body: unknown = await response.json();
  if (!object(body) || !object(body.conversation))
    return Response.json(body, { status: response.status, headers: noStoreHeaders });
  const id = conversationId ?? body.conversation.id;
  const conversation = typeof id === 'string' ? await getConversationForUser(id, userId) : null;
  if (!conversation) return Response.json({ error: 'conversation_not_found' }, { status: 404, headers: noStoreHeaders });
  const next: Record<string, unknown> = { ...body, conversation };
  if (object(next.message)) next.message = conversation.messages?.find(message => message.id === (body.message as Record<string, unknown>).id) ?? null;
  if ('blockStatus' in next) next.blockStatus = await getConversationBlockStatus(conversation.id, userId);
  return Response.json(next, { status: response.status, headers: noStoreHeaders });
}
