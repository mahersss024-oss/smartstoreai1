import { z } from 'zod';
import { claimDirectImageUpload } from '@/agent/marketplace/direct-image-uploads';
import { DirectImageUploadError } from '@/agent/marketplace/direct-image-upload-policy';
import { directImageRoute, imageUploadWorkerAuthorized, readDirectImageJson } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const claimInput = z.object({ outputFormats: z.array(z.enum(['webp-v1', 'jpeg-v1'])).max(2).optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  if (!imageUploadWorkerAuthorized(request)) return Response.json({ error: 'worker_auth_required' }, { status: 401, headers: noStoreHeaders });
  return directImageRoute(async () => {
    // Accept the capability field during Worker rollout; lease targets define
    // the exact outputs, and new leases retain only display and thumbnail.
    const parsed = claimInput.safeParse(await readDirectImageJson(request));
    if (!parsed.success) throw new DirectImageUploadError('invalid_request', 400);
    return claimDirectImageUpload((await context.params).uploadId);
  });
}
