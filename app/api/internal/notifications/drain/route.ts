import { drainNotificationDeliveries } from '@/lib/push/delivery-jobs';
import { imageUploadWorkerAuthorized } from '@/lib/api/direct-image-upload-route';
import { noStoreHeaders } from '@/lib/api/no-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!imageUploadWorkerAuthorized(request)) return Response.json({ error: 'worker_auth_required' }, { status: 401, headers: noStoreHeaders });
  try { return Response.json(await drainNotificationDeliveries(10), { headers: noStoreHeaders }); }
  catch { return Response.json({ error: 'notification_delivery_unavailable' }, { status: 503, headers: noStoreHeaders }); }
}
