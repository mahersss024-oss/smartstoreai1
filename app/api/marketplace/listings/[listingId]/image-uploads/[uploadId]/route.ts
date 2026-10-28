import { cancelOwnedDirectImageUpload, getOwnedDirectImageUpload } from '@/agent/marketplace/direct-image-uploads';
import { directImageRoute } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ listingId: string; uploadId: string }> };

export async function GET(request: Request, context: Context) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => {
    const { listingId, uploadId } = await context.params;
    return getOwnedDirectImageUpload(listingId, session.user.id, uploadId);
  });
}

export async function DELETE(request: Request, context: Context) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => {
    const { listingId, uploadId } = await context.params;
    return cancelOwnedDirectImageUpload(listingId, session.user.id, uploadId);
  });
}
