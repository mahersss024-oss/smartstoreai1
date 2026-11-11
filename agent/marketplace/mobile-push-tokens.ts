import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionMaxAgeSeconds } from '@/lib/auth/session';
import { createMobilePushRemovalToken } from '@/lib/push/mobile-registration';

type MobilePushPlatform = 'ios' | 'android';

export type MobilePushDeliveryRegistration = {
  id: string;
  token: string;
  platform: MobilePushPlatform;
  registrationKey: string | null;
};

export type MobilePushTokenInput = {
  userId: string;
  token: string;
  platform: MobilePushPlatform;
  appVersion?: string | null;
  locale?: string | null;
  userAgent?: string | null;
  sessionExpiresAt?: Date;
};

type StoredMobilePushToken = {
  id: string;
  userId: string;
  token: string;
  platform: MobilePushPlatform;
  appVersion: string | null;
  locale: string | null;
  userAgent: string | null;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  sessionExpiresAt?: string;
  registrationKey?: string;
};

function resolveStoreFilePath() {
  const configured = process.env.SMARTSTORE_DATA_DIR?.trim();

  // Trace the store file, not every file in the writable data directory.
  return configured
    ? join(configured, 'mobile-push-tokens-store.json')
    : join(process.cwd(), '.data', 'mobile-push-tokens-store.json');
}

const filePath = resolveStoreFilePath();

const tokens = new Map<string, StoredMobilePushToken>();
let storeLoaded = false;

function isDatabaseStore() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

function shouldPersist() {
  return !isDatabaseStore() && process.env.npm_lifecycle_event !== 'test';
}

function nowIso() {
  return new Date().toISOString();
}

function loadFileStore() {
  if (storeLoaded) {
    return;
  }

  storeLoaded = true;

  if (!shouldPersist() || !existsSync(filePath)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      tokens?: StoredMobilePushToken[];
    };

    for (const token of parsed.tokens ?? []) {
      if (token.token) {
        tokens.set(token.token, token);
      }
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[mobile_push_tokens] load_failed=${errorName}`);
  }
}

function persistFileStore() {
  if (!shouldPersist()) {
    return;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(
      { tokens: [...tokens.values()] },
      null,
      2,
    ),
  );
}

export async function saveMobilePushToken(input: MobilePushTokenInput) {
  return (await saveMobilePushRegistration(input)).id;
}

export async function saveMobilePushRegistration(input: MobilePushTokenInput) {
  const registrationKey = randomUUID();
  const sessionExpiresAt = input.sessionExpiresAt ?? new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    const record = await prisma.mobilePushToken.upsert({
      where: { token: input.token },
      create: {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
        userAgent: input.userAgent ?? null,
        isActive: true,
        sessionExpiresAt,
        registrationKey,
      },
      update: {
        userId: input.userId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
        userAgent: input.userAgent ?? null,
        isActive: true,
        sessionExpiresAt,
        registrationKey,
        lastSeenAt: new Date(),
      },
    });

    return { id: record.id, removalToken: createMobilePushRemovalToken(input.userId, input.token, registrationKey) };
  }

  loadFileStore();

  const existing = tokens.get(input.token);
  const timestamp = nowIso();
  const record: StoredMobilePushToken = {
    id: existing?.id ?? randomUUID(),
    userId: input.userId,
    token: input.token,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    locale: input.locale ?? null,
    userAgent: input.userAgent ?? null,
    isActive: true,
    lastSeenAt: timestamp,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
    registrationKey,
  };

  tokens.set(record.token, record);
  persistFileStore();

  return { id: record.id, removalToken: createMobilePushRemovalToken(input.userId, input.token, registrationKey) };
}

export async function deactivateMobilePushToken(token: string, userId?: string, registrationKey?: string) {
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    await prisma.mobilePushToken.updateMany({
      where: {
        token,
        ...(userId ? { userId } : {}),
        ...(registrationKey ? { registrationKey } : {}),
      },
      data: { isActive: false, updatedAt: new Date() },
    });

    return;
  }

  loadFileStore();

  const existing = tokens.get(token);

  if (!existing || (userId && existing.userId !== userId) || (registrationKey && existing.registrationKey !== registrationKey)) {
    return;
  }

  existing.isActive = false;
  existing.updatedAt = nowIso();
  tokens.set(existing.token, existing);
  persistFileStore();
}

export async function listActiveMobilePushTokensForUser(userId: string) {
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    return prisma.mobilePushToken.findMany({
      where: { userId, isActive: true, sessionExpiresAt: { gt: new Date() }, user: { deletedAt: null } },
      select: {
        id: true,
        token: true,
        platform: true,
        registrationKey: true,
      },
    });
  }

  loadFileStore();

  return [...tokens.values()]
    .filter((record) => record.userId === userId && record.isActive &&
      Boolean(record.sessionExpiresAt && new Date(record.sessionExpiresAt).getTime() > Date.now()))
    .map((record) => ({
      id: record.id,
      token: record.token,
      platform: record.platform,
      registrationKey: record.registrationKey ?? null,
    }));
}

/** A previously read device token is not a current delivery authorization.
 * Re-registration, sign-out and session expiry all invalidate that snapshot.
 */
export async function isMobilePushRegistrationCurrent(userId: string, registration: MobilePushDeliveryRegistration) {
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');
    return Boolean(await prisma.mobilePushToken.findFirst({
      where: {
        id: registration.id, token: registration.token, userId,
        platform: registration.platform, registrationKey: registration.registrationKey,
        isActive: true, sessionExpiresAt: { gt: new Date() }, user: { deletedAt: null },
      },
      select: { id: true },
    }));
  }
  loadFileStore();
  const current = tokens.get(registration.token);
  return Boolean(current && current.id === registration.id && current.userId === userId &&
    current.platform === registration.platform && (current.registrationKey ?? null) === registration.registrationKey &&
    current.isActive && current.sessionExpiresAt && new Date(current.sessionExpiresAt).getTime() > Date.now());
}

export function resetMobilePushTokenStoreForTests() {
  tokens.clear();
  storeLoaded = false;
}
