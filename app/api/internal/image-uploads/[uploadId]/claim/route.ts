import { claimDirectImageUpload } from '@/agent/marketplace/direct-image-uploads';
import { directImageRoute, imageUploadWorkerAuthorized } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  if (!imageUploadWorkerAuthorized(request)) return Response.json({ error: 'worker_auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => claimDirectImageUpload((await context.params).uploadId));
}
