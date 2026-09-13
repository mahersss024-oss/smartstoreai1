import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateReadiness } from '@/scripts/readiness-check';

const productionEnv = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/smartstore',
  DEEPSEEK_API_KEY: 'deepseek-key',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS: '100',
  SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS: '2000',
  SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS: '60000',
  SMARTSTORE_IMAGE_STORAGE: 'cloudinary',
  SMARTSTORE_MARKETPLACE_STORE: 'database',
  CLOUDINARY_CLOUD_NAME: 'smartstore',
  CLOUDINARY_API_KEY: 'cloudinary-key',
  CLOUDINARY_API_SECRET: 'cloudinary-secret',
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
