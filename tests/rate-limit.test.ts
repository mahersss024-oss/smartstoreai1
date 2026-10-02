import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { checkRateLimit } from '@/lib/rate-limit';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

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

test('falls back to memory rate limiting when redis stalls', async () => {
  const previousEnv = {
    SMARTSTORE_RATE_LIMIT_BACKEND: process.env.SMARTSTORE_RATE_LIMIT_BACKEND,
    SMARTSTORE_RATE_LIMIT_REDIS_TIMEOUT_MS:
      process.env.SMARTSTORE_RATE_LIMIT_REDIS_TIMEOUT_MS,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let aborted = false;

  process.env.SMARTSTORE_RATE_LIMIT_BACKEND = 'redis';
  process.env.SMARTSTORE_RATE_LIMIT_REDIS_TIMEOUT_MS = '1';
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  console.warn = () => undefined;

  globalThis.fetch = async (_input, init) => {
    await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });

    throw new Error('unreachable');
  };

  try {
    const result = await checkRateLimit({
      namespace: 'test-rate-limit-redis-timeout',
      clientId: 'client:one',
      maxRequests: 1,
      windowMs: 60_000,
    });

    assert.equal(result, null);
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('sensitive mutation and streaming routes enforce rate limits', () => {
  const expectations = [
    {
      path: ['app', 'api', 'chat', 'route.ts'],
      patterns: [/checkChatRateLimit/],
    },
    {
      path: ['app', 'api', 'chat', 'reset', 'route.ts'],
      patterns: [/enforceApiRateLimit/, /chat_reset/],
    },
    {
      path: ['app', 'api', 'marketplace', 'listings', '[listingId]', 'images', 'route.ts'],
      patterns: [/enforceApiRateLimit/, /image_upload/],
    },
    {
      path: ['app', 'api', 'account', 'profile', 'picture', 'route.ts'],
      patterns: [/enforceApiRateLimit/, /account_profile_picture_upload/],
    },
    {
      path: ['app', 'api', 'admin', 'listings', '[listingId]', 'route.ts'],
      patterns: [/enforceApiRateLimit/, /admin_listing_mutation/],
    },
    {
      path: ['app', 'api', 'admin', 'users', '[userId]', 'route.ts'],
      patterns: [/enforceApiRateLimit/, /admin_user_mutation/],
    },
  ];

  for (const expectation of expectations) {
    const source = readProjectFile(...expectation.path);

    for (const pattern of expectation.patterns) {
      assert.match(source, pattern);
    }
  }

  const sharedLimiter = readProjectFile('lib', 'rate-limit.ts');
  assert.match(sharedLimiter, /export async function checkChatRateLimit/);
  assert.match(sharedLimiter, /namespace: 'chat'/);
});
