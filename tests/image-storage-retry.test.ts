import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageStorageResponseError, retryImageStorage } from '@/agent/marketplace/image-storage-retry';

test('image provider retry recovers transient failures within three attempts', async () => {
  const budgets: number[] = [];
  const result = await retryImageStorage(async remainingMs => {
    budgets.push(remainingMs);
    if (budgets.length === 1) throw new ImageStorageResponseError(503);
    if (budgets.length === 2) throw new TypeError('connection reset');
    return 'stored';
  }, 2000);
  assert.equal(result, 'stored');
  assert.equal(budgets.length, 3);
  assert.ok(budgets[2] < budgets[0] - 500, 'backoff shares the original timeout budget');
});

test('authorization errors are not retried and transient attempts stop at three', async () => {
  for (const [status, expected] of [[403, 1], [429, 3], [503, 3]]) {
    let attempts = 0;
    await assert.rejects(retryImageStorage(async () => {
      attempts++;
      throw new ImageStorageResponseError(status);
    }, 2000));
    assert.equal(attempts, expected);
  }
});

test('an expired provider timeout does not start another request', async () => {
  let attempts = 0;
  await assert.rejects(retryImageStorage(async () => {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 20));
    throw new DOMException('timed out', 'TimeoutError');
  }, 10));
  assert.equal(attempts, 1);
});
