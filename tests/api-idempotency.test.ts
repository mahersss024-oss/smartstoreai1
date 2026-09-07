import assert from 'node:assert/strict';
import test from 'node:test';

import { reserveIdempotencyKey } from '@/lib/api/idempotency';

test('returns the stored idempotent response for duplicate keys', async () => {
  const request = new Request('https://smartstore.test/api', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'duplicate-listing-create',
    },
  });
  const first = await reserveIdempotencyKey(request, {
    namespace: 'test_idempotency',
    actorKey: 'user:one',
  });

  assert.equal(first?.response, undefined);

  const firstResponse = await first?.complete({ ok: true, id: 'listing:one' }, 201);
  assert.equal(firstResponse?.status, 201);

  const second = await reserveIdempotencyKey(request, {
    namespace: 'test_idempotency',
    actorKey: 'user:one',
  });

  assert.equal(second?.response?.status, 201);
  assert.deepEqual(await second?.response?.json(), {
    ok: true,
    id: 'listing:one',
  });
});

test('scopes idempotency keys per actor', async () => {
  const request = new Request('https://smartstore.test/api', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'same-browser-key',
    },
  });
  const first = await reserveIdempotencyKey(request, {
    namespace: 'test_actor_scope',
    actorKey: 'user:one',
  });
  const secondActor = await reserveIdempotencyKey(request, {
    namespace: 'test_actor_scope',
    actorKey: 'user:two',
  });

  assert.equal(first?.response, undefined);
  assert.equal(secondActor?.response, undefined);
});
