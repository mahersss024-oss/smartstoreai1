import sharp from 'sharp';
import { getS3ObjectStorageConfig } from './object-storage';

const maxBytes = 12 * 1024 * 1024;
const readinessBudgetMs = 15_000;
const retryDelaysMs = [200, 500] as const;
type DeliveryUrls = { displayUrl: string; thumbnailUrl: string };

export class ListingImageDeliveryUnavailableError extends Error {
  constructor() {
    super('Listing image delivery is not ready. Retry the saved upload.');
    this.name = 'ListingImageDeliveryUnavailableError';
  }
}

async function readImage(response: Response, signal: AbortSignal) {
  const declared = response.headers.get('content-length');
  if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0].trim() !== 'image/webp' ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > maxBytes)) || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new ListingImageDeliveryUnavailableError();
  }
  const reader = response.body.getReader();
  const aborted = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', aborted, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new ListingImageDeliveryUnavailableError();
      chunks.push(value);
    }
    if (!length || (declared !== null && Number(declared) !== length)) throw new ListingImageDeliveryUnavailableError();
    return Buffer.concat(chunks, length);
  } finally {
    signal.removeEventListener('abort', aborted);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Probe the exact public URLs before attach/ready, never a signed origin URL.
 * This also primes the responding CDN edge; it does not warm every client/edge.
 * Keep failures retryable and leave existing storage cleanup ownership intact.
 */
export async function verifyListingImageDelivery(urls: DeliveryUrls, deadline = Date.now() + readinessBudgetMs) {
  const variants = [{ url: urls.displayUrl, dimension: 900 }, { url: urls.thumbnailUrl, dimension: 360 }];
  if (process.env.NODE_ENV !== 'production' && variants.every(variant => variant.url.startsWith('data:image/webp;base64,'))) return;
  const base = new URL(getS3ObjectStorageConfig().publicUrl ?? '');
  const prefix = `${base.pathname.replace(/\/$/, '')}/`;
  // Only server-configured delivery paths may be fetched; never arbitrary input.
  for (const variant of variants) {
    const url = new URL(variant.url);
    if (base.protocol !== 'https:' || url.protocol !== 'https:' || url.origin !== base.origin ||
        base.username || base.password || base.search || base.hash || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(`${prefix}listings/`) || !url.pathname.endsWith('.webp')) {
      throw new ListingImageDeliveryUnavailableError();
    }
  }
  const end = Math.min(deadline, Date.now() + readinessBudgetMs);
  const signal = AbortSignal.timeout(Math.max(1, end - Date.now()));
  const results = await Promise.allSettled(variants.map(async ({ url, dimension }) => {
    for (let attempt = 0; ; attempt++) {
      try {
        if (Date.now() >= end) throw new ListingImageDeliveryUnavailableError();
        signal.throwIfAborted();
        const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', signal });
        const bytes = await readImage(response, signal);
        const image = sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: 45_000_000 });
        const info = await image.metadata();
        if (info.format !== 'webp' || !info.width || !info.height || info.width > dimension || info.height > dimension || (info.pages ?? 1) !== 1)
          throw new ListingImageDeliveryUnavailableError();
        // Metadata alone can accept a truncated file. Decode it as well.
        await image.resize(1, 1).raw().toBuffer();
        signal.throwIfAborted();
        return;
      } catch {
        const delay = retryDelaysMs[attempt];
        if (signal.aborted || delay === undefined || Date.now() + delay >= end) throw new ListingImageDeliveryUnavailableError();
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }));
  if (results.some(result => result.status === 'rejected')) throw new ListingImageDeliveryUnavailableError();
}
