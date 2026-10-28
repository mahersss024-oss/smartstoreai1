import { createDirectImageUpload, directImageUploadInput, getOwnedActiveDirectImageUploads } from '@/agent/marketplace/direct-image-uploads';
import { DirectImageUploadError } from '@/agent/marketplace/direct-image-upload-policy';
import { directImageRoute, readDirectImageJson } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ listingId: string }> }) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => getOwnedActiveDirectImageUploads((await context.params).listingId, session.user.id));
}

export async function POST(request: Request, context: { params: Promise<{ listingId: string }> }) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  const limited = await enforceApiRateLimit(request, { namespace: 'image_upload_reservation', actorId: session.user.id, maxRequests: 10, windowMs: 60_000 });
  if (limited) return limited;
  return directImageRoute(async () => {
    const key = request.headers.get('idempotency-key')?.trim();
    if (!key || key.length > 200) throw new DirectImageUploadError('idempotency_key_required', 400);
    const parsed = directImageUploadInput.safeParse(await readDirectImageJson(request));
    if (!parsed.success) throw new DirectImageUploadError('invalid_request', 400);
    const { listingId } = await context.params;
    return createDirectImageUpload(listingId, session.user.id, key, parsed.data);
  }, 201);
}
