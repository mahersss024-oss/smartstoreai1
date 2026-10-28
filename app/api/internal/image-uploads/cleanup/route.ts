import { cleanupExpiredDirectImageUploads } from '@/agent/marketplace/direct-image-uploads';
import { directImageRoute, imageUploadWorkerAuthorized } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';
import { cleanupPendingImageObjects } from '@/agent/marketplace/image-object-cleanup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!imageUploadWorkerAuthorized(request)) return Response.json({ error: 'worker_auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => ({ ...await cleanupExpiredDirectImageUploads(),
    objects: await cleanupPendingImageObjects() }));
}
