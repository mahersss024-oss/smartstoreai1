import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type ModelAssessment = {
  decision: 'allow' | 'block' | 'needs_review';
  reasons: string[];
  unavailable?: boolean;
};
type ModelReviewInput = {
  subject: 'listing' | 'message' | 'image';
  subjectId: string;
  listingId?: string;
  userId: string;
  text: string;
  assessment: ModelAssessment;
};
const localReviews = new Map<string, ModelReviewInput>();
const resolvedLocalReviews = new Set<string>();

export function hasPendingLocalListingReview(listingId: string) {
  return [...localReviews].some(([id, review]) => review.listingId === listingId &&
    review.subject !== 'message' && !resolvedLocalReviews.has(id));
}

export function resolveLocalListingReviews(listingId: string) {
  for (const [id, review] of localReviews) {
    if (review.listingId === listingId && review.subject !== 'message') resolvedLocalReviews.add(id);
  }
}

export function modelReviewImageFingerprint(images: readonly Uint8Array[]) {
  const hash = createHash('sha256');
  for (const image of images) hash.update(`${image.byteLength}:`).update(image);
  return hash.digest('hex');
}

export async function recordModelReview(input: ModelReviewInput, database: Pick<Prisma.TransactionClient, 'adminAuditLog'> = prisma) {
  if (input.assessment.decision === 'allow' && !input.assessment.unavailable) return;
  const id = `model-review-${createHash('sha256').update(JSON.stringify([input.subject, input.subjectId, input.userId, input.text, input.assessment.decision, Boolean(input.assessment.unavailable)])).digest('hex')}`;
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') {
    if (localReviews.size >= 1024 && !localReviews.has(id)) {
      const oldest = localReviews.keys().next().value!;
      localReviews.delete(oldest);
      resolvedLocalReviews.delete(oldest);
    }
    localReviews.set(id, input);
    return;
  }
  let contentText = input.text;
  if (input.subject === 'listing') {
    try {
      const parsed = JSON.parse(input.text);
      contentText = [parsed.title, parsed.description].filter(value => typeof value === 'string').join('\n');
    } catch { /* Plain text remains readable without an object wrapper. */ }
  }
  // A system audit event is not a customer report and does not lock the content as evidence.
  await database.adminAuditLog.createMany({
    data: [{ id, adminId: null, action: 'review_report', targetType: 'ModelReview', targetId: input.subjectId,
      metadata: { ...input, contentText, automated: true, advisoryOnly: true } as unknown as Prisma.InputJsonObject }],
    skipDuplicates: true,
  });
}

export function getLocalModelReviews() {
  return [...localReviews.values()];
}
