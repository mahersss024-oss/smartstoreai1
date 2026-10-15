import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runOptionalTask } from '@/lib/optional-task';

test('optional tasks preserve successful results', async () => {
  assert.deepEqual(await runOptionalTask('success', () => ({ ok: true })), { ok: true });
});

test('optional task synchronous and asynchronous failures do not escape', async (t) => {
  t.mock.method(console, 'warn', () => undefined);
  assert.equal(await runOptionalTask('sync', () => { throw new Error('optional failure'); }), null);
  assert.equal(await runOptionalTask('async', () => Promise.reject(new Error('optional failure'))), null);
  assert.equal(await runOptionalTask('next_task', () => 'still running'), 'still running');
});

test('an unresponsive optional task has a bounded wait', async (t) => {
  t.mock.method(console, 'warn', () => undefined);
  assert.equal(await runOptionalTask('stalled', () => new Promise<never>(() => undefined), 10), null);
});

test('late rejection after an optional timeout is handled', async (t) => {
  t.mock.method(console, 'warn', () => undefined);
  let fail!: (error: Error) => void;
  const pending = new Promise<never>((_, reject) => { fail = reject; });
  assert.equal(await runOptionalTask('late_failure', () => pending, 10), null);
  fail(new Error('late failure'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await runOptionalTask('after_late_failure', () => 'ok'), 'ok');
});

test('publication and global optional reads are isolated without weakening database health', () => {
  const repository = readFileSync('agent/marketplace/repository.ts', 'utf8');
  assert.match(repository, /runOptionalTask\('listing_follower_notifications'/);
  assert.match(repository, /runOptionalTask\('listing_similar_notifications'/);
  assert.equal((repository.match(/await notifyPublishedListingBestEffort\(/g) ?? []).length, 2);
  const health = readFileSync('app/api/health/route.ts', 'utf8');
  assert.match(health, /runOptionalTask\('health_analytics'/);
  assert.match(health, /status: database.ok \? 200 : 503/);
  assert.match(readFileSync('lib/site-message.ts', 'utf8'), /runOptionalTask\('site_message'/);
});
