import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';

const randomListingSuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 24);

export function createListingId(sellerId: string, operationKey?: string) {
  if (!operationKey) return `c${randomListingSuffix()}`;
  // Retries keep the same identifier without exposing the chat operation key.
  const hash = createHash('sha256').update(JSON.stringify(['listing-id-v1', sellerId, operationKey])).digest('hex');
  return `c${BigInt(`0x${hash}`).toString(36).padStart(50, '0').slice(0, 24)}`;
}
