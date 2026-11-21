import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

type IdempotencyInput = {
  namespace: string;
  actorKey: string;
};

type IdempotencyReservation = {
  operationKey: string;
  response?: Response;
  complete: (body: unknown, status?: number) => Promise<Response>;
  abandon: () => Promise<void>;
};

type MemoryIdempotencyRecord = {
  status: 'pending' | 'completed';
  statusCode?: number;
  response?: unknown;
  expiresAt: number;
  updatedAt: number;
};

const memoryRecords = new Map<string, MemoryIdempotencyRecord>();
const memoryPendingTtlMs = 2 * 60_000;
const memoryCompletedTtlMs = 15 * 60_000;
const memoryMaxEntries = 5_000;

function pruneMemoryRecords(now = Date.now()) {
  for (const [recordKey, record] of memoryRecords) {
    if (record.expiresAt <= now) {
      memoryRecords.delete(recordKey);
    }
  }

  if (memoryRecords.size <= memoryMaxEntries) {
    return;
  }

  const oldestRecords = [...memoryRecords.entries()].sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  const overflowCount = memoryRecords.size - memoryMaxEntries;

  for (let index = 0; index < overflowCount; index += 1) {
    const oldestRecord = oldestRecords[index];

    if (!oldestRecord) {
      break;
    }

    memoryRecords.delete(oldestRecord[0]);
  }
}

function shouldUseDatabaseStore() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

function getIdempotencyKey(request: Request) {
  const key = request.headers.get('idempotency-key')?.trim();

  if (!key || key.length > 200) {
    return null;
  }

  return key;
}

function memoryKey(input: IdempotencyInput, key: string) {
  return `${input.namespace}:${input.actorKey}:${key}`;
}

function operationKey(input: IdempotencyInput, key: string) {
  // A source operation can retain this identity after the response receipt is
  // lost or pruned. Keep clients' raw keys private and isolate every actor/API.
  return createHash('sha256')
    .update(JSON.stringify(['api-idempotency-v1', input.namespace, input.actorKey, key]))
    .digest('hex');
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function toJsonSafeValue(body: unknown) {
  return structuredClone(body) as Prisma.InputJsonValue;
}

export function isStaleIdempotencyReservation(updatedAt: Date, now = Date.now()) {
  return updatedAt.getTime() <= now - memoryPendingTtlMs;
}

function createDatabaseReservationHandle(
  sourceOperationKey: string,
  lease: { id: string; updatedAt: Date },
): IdempotencyReservation {
  const where = { ...lease, status: 'pending' };
  return {
    operationKey: sourceOperationKey,
    complete: async (body, status = 200) => {
      const safeBody = toJsonSafeValue(body);

      // A request may finish after another attempt has claimed its reservation.
      await prisma.apiIdempotencyKey.updateMany({
        where,
        data: {
          status: 'completed',
          statusCode: status,
          response: safeBody,
        },
      });

      return jsonResponse(safeBody, status);
    },
    abandon: async () => {
      await prisma.apiIdempotencyKey.deleteMany({ where });
    },
  };
}

export async function reserveIdempotencyKey(
  request: Request,
  input: IdempotencyInput,
): Promise<IdempotencyReservation | null> {
  const key = getIdempotencyKey(request);

  if (!key) {
    return null;
  }
  const sourceOperationKey = operationKey(input, key);

  if (!shouldUseDatabaseStore()) {
    const now = Date.now();
    pruneMemoryRecords(now);

    const recordKey = memoryKey(input, key);
    const existing = memoryRecords.get(recordKey);

    if (existing?.status === 'completed') {
      return {
        operationKey: sourceOperationKey,
        response: jsonResponse(existing.response, existing.statusCode),
        complete: async (body, status) => jsonResponse(body, status),
        abandon: async () => {},
      };
    }

    if (existing?.status === 'pending') {
      return {
        operationKey: sourceOperationKey,
        response: jsonResponse(
          {
            error: 'idempotency_in_progress',
            message: 'This request is already being processed.',
          },
          409,
        ),
        complete: async (body, status) => jsonResponse(body, status),
        abandon: async () => {},
      };
    }

    const lease: MemoryIdempotencyRecord = {
      status: 'pending',
      updatedAt: now,
      expiresAt: now + memoryPendingTtlMs,
    };
    memoryRecords.set(recordKey, lease);

    return {
      operationKey: sourceOperationKey,
      complete: async (body, status = 200) => {
        const completedAt = Date.now();
        const safeBody = toJsonSafeValue(body);

        if (memoryRecords.get(recordKey) === lease) {
          memoryRecords.set(recordKey, {
            status: 'completed',
            statusCode: status,
            response: safeBody,
            updatedAt: completedAt,
            expiresAt: completedAt + memoryCompletedTtlMs,
          });
        }

        return jsonResponse(safeBody, status);
      },
      abandon: async () => {
        if (memoryRecords.get(recordKey) === lease) memoryRecords.delete(recordKey);
      },
    };
  }

  const identity = { ...input, key };
  const [created] = await prisma.apiIdempotencyKey.createManyAndReturn({
    data: [identity],
    select: { id: true, updatedAt: true },
    skipDuplicates: true,
  });
  if (created) return createDatabaseReservationHandle(sourceOperationKey, created);

  const existing = await prisma.apiIdempotencyKey.findUnique({
    where: { namespace_actorKey_key: identity },
  });

  if (existing?.status === 'completed' && existing.response !== null) {
    return {
      operationKey: sourceOperationKey,
      response: jsonResponse(existing.response, existing.statusCode ?? 200),
      complete: async (body, status) => jsonResponse(body, status),
      abandon: async () => {},
    };
  }

  const now = new Date();
  if (existing?.status === 'pending' && isStaleIdempotencyReservation(existing.updatedAt, now.getTime())) {
    const claim = await prisma.apiIdempotencyKey.updateMany({
      where: { id: existing.id, status: 'pending', updatedAt: existing.updatedAt },
      data: { statusCode: null, response: Prisma.DbNull, updatedAt: now },
    });
    if (claim.count === 1) {
      return createDatabaseReservationHandle(sourceOperationKey, { id: existing.id, updatedAt: now });
    }
  }

  return {
    operationKey: sourceOperationKey,
    response: jsonResponse(
      { error: 'idempotency_in_progress', message: 'This request is already being processed.' },
      409,
    ),
    complete: async (body, status) => jsonResponse(body, status),
    abandon: async () => {},
  };
}
