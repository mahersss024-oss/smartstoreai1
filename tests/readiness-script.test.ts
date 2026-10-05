import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateReadiness } from '@/scripts/readiness-check';

const productionEnv = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/smartstore',
  DEEPSEEK_API_KEY: 'deepseek-key',
  NEXT_PUBLIC_APP_URL: 'https://www.souqhamad.com',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS: '100',
  SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS: '2000',
  SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS: '60000',
  SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS: '30000',
  SMARTSTORE_RATE_LIMIT_REDIS_TIMEOUT_MS: '2000',
  SMARTSTORE_PUSH_TIMEOUT_MS: '10000',
  SMARTSTORE_IMAGE_STORAGE: 's3',
  SMARTSTORE_MARKETPLACE_STORE: 'database',
  SMARTSTORE_OBJECT_STORAGE_ENDPOINT:
    'https://account-id.r2.cloudflarestorage.com',
  SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images',
  SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'object-access-key',
  SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'object-secret-key',
  SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
  SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.souqhamad.com',
} satisfies Record<string, string>;

test('readiness fails production when durable store dependencies are missing', () => {
  const result = evaluateReadiness({
    NODE_ENV: 'production',
    SMARTSTORE_MARKETPLACE_STORE: 'file',
  });

  assert.equal(result.status, 'fail');
  assert.ok(
    result.checks.some(
      (check) =>
        check.name === 'marketplace_store' && check.status === 'fail',
    ),
  );
});

test('readiness passes core production dependencies and warns for optional Apple OAuth', () => {
  const result = evaluateReadiness(productionEnv);

  assert.equal(result.failures, 0);
  assert.equal(result.status, 'warn');
  assert.ok(
    result.checks.some(
      (check) => check.name === 'apple_oauth' && check.status === 'warn',
    ),
  );
});

test('readiness rejects unsafe DeepSeek queue configuration', () => {
  const result = evaluateReadiness({
    ...productionEnv,
    SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS: '800',
  });

  assert.equal(result.status, 'fail');
  assert.ok(
    result.checks.some(
      (check) =>
        check.name === 'deepseek_concurrency' && check.status === 'fail',
    ),
  );
});

test('readiness rejects unsafe operational timeout configuration', () => {
  const result = evaluateReadiness({
    ...productionEnv,
    SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS: '120000',
  });

  assert.equal(result.status, 'fail');
  assert.ok(
    result.checks.some(
      (check) =>
        check.name === 'object_storage_timeout' && check.status === 'fail',
    ),
  );
});

test('readiness rejects untrusted production public app urls', () => {
  const result = evaluateReadiness({
    ...productionEnv,
    NEXT_PUBLIC_APP_URL: 'https://attacker.example',
  });

  assert.equal(result.status, 'fail');
  assert.ok(
    result.checks.some(
      (check) =>
        check.name === 'NEXT_PUBLIC_APP_URL' && check.status === 'fail',
    ),
  );
});

test('readiness reports production rate limiting scope', () => {
  const memoryOnly = evaluateReadiness(productionEnv);

  assert.ok(
    memoryOnly.checks.some(
      (check) =>
        check.name === 'rate_limit_backend' &&
        check.status === 'warn' &&
        /instance-local memory/i.test(check.message),
    ),
  );

  const redisBacked = evaluateReadiness({
    ...productionEnv,
    UPSTASH_REDIS_REST_URL: 'https://redis.example',
    UPSTASH_REDIS_REST_TOKEN: 'redis-token',
  });

  assert.ok(
    redisBacked.checks.some(
      (check) =>
        check.name === 'rate_limit_backend' && check.status === 'pass',
    ),
  );
});

test('readiness fails when redis rate limiting is requested without credentials', () => {
  const result = evaluateReadiness({
    ...productionEnv,
    SMARTSTORE_RATE_LIMIT_BACKEND: 'redis',
  });

  assert.equal(result.status, 'fail');
  assert.ok(
    result.checks.some(
      (check) =>
        check.name === 'rate_limit_backend' && check.status === 'fail',
    ),
  );
});
