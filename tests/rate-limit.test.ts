import assert from 'node:assert/strict';
import test from 'node:test';

import { checkRateLimit } from '@/lib/rate-limit';

test('rate limit is scoped by namespace and client', async () => {
  const first = await checkRateLimit({
    namespace: 'test-rate-limit',
    clientId: 'client:one',
    maxRequests: 1,
    windowMs: 60_000,
  });
  const second = await checkRateLimit({
    namespace: 'test-rate-limit',
    clientId: 'client:one',
    maxRequests: 1,
    windowMs: 60_000,
  });
  const otherNamespace = await checkRateLimit({
    namespace: 'test-rate-limit-other',
    clientId: 'client:one',
    maxRequests: 1,
    windowMs: 60_000,
  });

  assert.equal(first, null);
  assert.equal(typeof second, 'number');
  assert.equal(otherNamespace, null);
});
