import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Persistence for Web Push subscriptions. Supports the same file/database
// switch as the rest of the marketplace so local dev and production share a
// single API surface.

type PushPlatform = 'web' | 'ios' | 'android';

export type PushSubscriptionInput = {
  userId?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform?: PushPlatform;
  userAgent?: string | null;
  locale?: string | null;
};

type StoredPushSubscription = {
  id: string;
  userId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: PushPlatform;
  userAgent: string | null;
  locale: string | null;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

function resolveStoreFilePath() {
  const configured = process.env.SMARTSTORE_DATA_DIR?.trim();

  // Trace the store file, not every file in the writable data directory.
  return configured
    ? join(configured, 'push-subscriptions-store.json')
    : join(process.cwd(), '.data', 'push-subscriptions-store.json');
}

const filePath = resolveStoreFilePath();

const subscriptions = new Map<string, StoredPushSubscription>();
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
      subscriptions?: StoredPushSubscription[];
    };

    for (const subscription of parsed.subscriptions ?? []) {
      if (subscription.endpoint) {
        subscriptions.set(subscription.endpoint, subscription);
      }
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[push_subscriptions] load_failed=${errorName}`);
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
      { subscriptions: [...subscriptions.values()] },
      null,
      2,
    ),
  );
}

export async function savePushSubscription(input: PushSubscriptionInput) {
  const platform: PushPlatform = input.platform ?? 'web';

  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    const record = await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        platform,
        userId: input.userId ?? null,
        userAgent: input.userAgent ?? null,
        locale: input.locale ?? null,
        isActive: true,
      },
      update: {
        p256dh: input.p256dh,
        auth: input.auth,
        platform,
        userId: input.userId ?? null,
        userAgent: input.userAgent ?? null,
        locale: input.locale ?? null,
        isActive: true,
        lastSeenAt: new Date(),
      },
    });

    return record.id;
  }

  loadFileStore();
  const existing = subscriptions.get(input.endpoint);
  const timestamp = nowIso();
  const record: StoredPushSubscription = {
    id: existing?.id ?? randomUUID(),
    userId: input.userId ?? null,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    platform,
    userAgent: input.userAgent ?? null,
    locale: input.locale ?? null,
    isActive: true,
    lastSeenAt: timestamp,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  subscriptions.set(record.endpoint, record);
  persistFileStore();

  return record.id;
}

export async function deactivatePushSubscription(endpoint: string) {
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    await prisma.pushSubscription.updateMany({
      where: { endpoint },
      data: { isActive: false, updatedAt: new Date() },
    });

    return;
  }

  loadFileStore();
  const existing = subscriptions.get(endpoint);

  if (!existing) {
    return;
  }

  existing.isActive = false;
  existing.updatedAt = nowIso();
  subscriptions.set(endpoint, existing);
  persistFileStore();
}

export async function listActiveSubscriptionsForUser(userId: string) {
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    const records = await prisma.pushSubscription.findMany({
      where: { userId, isActive: true },
    });

    return records.map((record) => ({
      id: record.id,
      endpoint: record.endpoint,
      p256dh: record.p256dh,
      auth: record.auth,
    }));
  }

  loadFileStore();

  return [...subscriptions.values()]
    .filter((record) => record.userId === userId && record.isActive)
    .map((record) => ({
      id: record.id,
      endpoint: record.endpoint,
      p256dh: record.p256dh,
      auth: record.auth,
    }));
}

export async function deactivateSubscriptionById(id: string) {
  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');

    await prisma.pushSubscription.updateMany({
      where: { id },
      data: { isActive: false, updatedAt: new Date() },
    });

    return;
  }

  loadFileStore();

  for (const record of subscriptions.values()) {
    if (record.id === id) {
      record.isActive = false;
      record.updatedAt = nowIso();
      subscriptions.set(record.endpoint, record);
      persistFileStore();
      return;
    }
  }
}

/** Test helper: reset the in-memory cache. */
export function resetPushSubscriptionStoreForTests() {
  subscriptions.clear();
  storeLoaded = false;
}
