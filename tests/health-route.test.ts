import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '@/app/api/health/route';

test('health endpoint reports ok in file store mode by default', async () => {
  const response = await GET();
  const body = (await response.json()) as {
    status: string;
    checks: { database: string };
    store: string;
    uptimeSeconds: number;
  };

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.database, 'ok');
  assert.equal(body.store, 'file');
  assert.ok(Number.isFinite(body.uptimeSeconds));
});

test('health endpoint never caches its response', async () => {
  const response = await GET();

  assert.match(
    response.headers.get('cache-control') ?? '',
    /no-store/,
  );
});
