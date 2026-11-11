import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { recordPublicListingView } from '@/lib/marketplace/listing-views';

test('public listing views increment once per screen-open id despite retries and concurrent requests', async () => {
  const receipts = new Set<string>();
  let views = 12;
  let creates = 0;
  const database = {
    $transaction: async <T>(operation: (tx: never) => Promise<T>) => operation({
      apiIdempotencyKey: {
        create: async ({ data }: { data: { actorKey: string; key: string } }) => {
          creates++;
          const key = `${data.actorKey}:${data.key}`;
          if (receipts.has(key)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          receipts.add(key);
        },
        update: async () => ({}),
        deleteMany: async () => ({ count: 0 }),
      },
      $queryRaw: async () => [{ views: ++views }],
    } as never),
  };
  const visitId = 'd0d7e2aa-2855-4471-a4cb-8cc15c0d725b';

  const duplicateAttempts = await Promise.all([
    recordPublicListingView('listing-1', visitId, database as never),
    recordPublicListingView('listing-1', visitId, database as never),
  ]);
  assert.deepEqual(duplicateAttempts.sort((left, right) => Number(right) - Number(left)), [13, null]);
  assert.equal(views, 13, 'duplicate receipt does not increment the listing');
  assert.equal(creates, 2);
  assert.equal([...receipts][0], `listing-1:${createHash('sha256').update(visitId).digest('hex')}`);
});

test('a listing that is no longer public is not counted', async () => {
  const database = {
    $transaction: async <T>(operation: (tx: never) => Promise<T>) => operation({
      apiIdempotencyKey: { create: async () => ({}), update: async () => ({}), deleteMany: async () => ({ count: 0 }) },
      $queryRaw: async () => [],
    } as never),
  };
  assert.equal(await recordPublicListingView('listing-paused', 'd0d7e2aa-2855-4471-a4cb-8cc15c0d725b', database as never), null);
});
