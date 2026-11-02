import type { Prisma } from '@prisma/client';

/** Credentials are operational account state, never part of an evidence response. */
export function redactEvidenceCredentials(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(redactEvidenceCredentials);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) =>
      key !== 'appleAuthorizationTokens' && child !== undefined
        ? [[key, redactEvidenceCredentials(child)]] : []));
  }
  return value;
}
