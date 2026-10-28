import { completeDirectImageUpload, directImageCompleteInput } from '@/agent/marketplace/direct-image-uploads';
import { DirectImageUploadError } from '@/agent/marketplace/direct-image-upload-policy';
import { directImageRoute, imageUploadWorkerAuthorized, readDirectImageJson } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  if (!imageUploadWorkerAuthorized(request)) return Response.json({ error: 'worker_auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => {
    const parsed = directImageCompleteInput.safeParse(await readDirectImageJson(request));
    if (!parsed.success) throw new DirectImageUploadError('invalid_request', 400);
    return completeDirectImageUpload((await context.params).uploadId, parsed.data);
  });
}
