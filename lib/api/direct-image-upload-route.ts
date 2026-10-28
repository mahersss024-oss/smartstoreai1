import { noStoreHeaders } from './no-store';
import { DirectImageUploadError, verifyImageWorkerSecret } from '@/agent/marketplace/direct-image-upload-policy';

export function imageUploadWorkerAuthorized(request: Request) {
  return verifyImageWorkerSecret(request.headers.get('authorization'), process.env.SMARTSTORE_IMAGE_WORKER_SECRET);
}

export async function readDirectImageJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DirectImageUploadError('invalid_json', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new DirectImageUploadError('request_timeout', 408));
      void reader.cancel().catch(() => {});
    }, 10_000);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) throw new DirectImageUploadError('request_too_large', 413);
      chunks.push(next.value);
    }
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {});
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new DirectImageUploadError('invalid_json', 400); }
}

export async function directImageRoute(operation: () => Promise<unknown>, status = 200) {
  try {
    return Response.json(await operation(), { status, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof DirectImageUploadError) {
      return Response.json({ error: error.code }, { status: error.status, headers: noStoreHeaders });
    }
    console.warn(`[direct_image_upload] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
    return Response.json({ error: 'image_processing_unavailable' }, { status: 503, headers: noStoreHeaders });
  }
}
