import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

type IdempotencyInput = {
  namespace: string;
  actorKey: string;
};

type IdempotencyReservation = {
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

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function toJsonSafeValue(body: unknown) {
  return structuredClone(body) as Prisma.InputJsonValue;
}

export async function reserveIdempotencyKey(
  request: Request,
  input: IdempotencyInput,
): Promise<IdempotencyReservation | null> {
  const key = getIdempotencyKey(request);

  if (!key) {
    return null;
  }

  if (!shouldUseDatabaseStore()) {
    const now = Date.now();
    pruneMemoryRecords(now);

    const recordKey = memoryKey(input, key);
    const existing = memoryRecords.get(recordKey);

    if (existing?.status === 'completed') {
      return {
        response: jsonResponse(existing.response, existing.statusCode),
        complete: async (body, status) => jsonResponse(body, status),
        abandon: async () => {},
      };
    }

    if (existing?.status === 'pending') {
      return {
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

    memoryRecords.set(recordKey, {
      status: 'pending',
      updatedAt: now,
      expiresAt: now + memoryPendingTtlMs,
    });

    return {
      complete: async (body, status = 200) => {
        const completedAt = Date.now();
        pruneMemoryRecords(completedAt);
        const safeBody = toJsonSafeValue(body);

        memoryRecords.set(recordKey, {
          status: 'completed',
          statusCode: status,
          response: safeBody,
          updatedAt: completedAt,
          expiresAt: completedAt + memoryCompletedTtlMs,
        });

        return jsonResponse(safeBody, status);
      },
      abandon: async () => {
        memoryRecords.delete(recordKey);
      },
    };
  }

  try {
    await prisma.apiIdempotencyKey.create({
      data: {
        namespace: input.namespace,
        actorKey: input.actorKey,
        key,
      },
    });
  } catch {
    const existing = await prisma.apiIdempotencyKey.findUnique({
      where: {
        namespace_actorKey_key: {
          namespace: input.namespace,
          actorKey: input.actorKey,
          key,
        },
      },
    });

    if (existing?.status === 'completed' && existing.response !== null) {
      return {
        response: jsonResponse(existing.response, existing.statusCode ?? 200),
        complete: async (body, status) => jsonResponse(body, status),
        abandon: async () => {},
      };
    }

    return {
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

  return {
    complete: async (body, status = 200) => {
      const safeBody = toJsonSafeValue(body);

      await prisma.apiIdempotencyKey.update({
        where: {
          namespace_actorKey_key: {
            namespace: input.namespace,
            actorKey: input.actorKey,
            key,
          },
        },
        data: {
          status: 'completed',
          statusCode: status,
          response: safeBody,
        },
      });

      return jsonResponse(safeBody, status);
    },
    abandon: async () => {
      await prisma.apiIdempotencyKey.deleteMany({
        where: {
          namespace: input.namespace,
          actorKey: input.actorKey,
          key,
          status: 'pending',
        },
      });
    },
  };
}
