import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryJsonCache } from '@/lib/api/memory-json-cache';

test('memory json cache returns values only within ttl', () => {
  let currentTime = 1_000;
  const cache = createMemoryJsonCache<{ value: string }>({
    ttlMs: 100,
    now: () => currentTime,
  });

  cache.set('listings:first-page', { value: 'fresh' });

  assert.deepEqual(cache.get('listings:first-page'), { value: 'fresh' });

  currentTime += 101;

  assert.equal(cache.get('listings:first-page'), null);
});

test('memory json cache evicts oldest entries when full', () => {
  const cache = createMemoryJsonCache<string>({
    ttlMs: 1_000,
    maxEntries: 2,
  });

  cache.set('first', 'one');
  cache.set('second', 'two');
  cache.set('third', 'three');

  assert.equal(cache.get('first'), null);
  assert.equal(cache.get('second'), 'two');
  assert.equal(cache.get('third'), 'three');
  assert.equal(cache.size(), 2);
});
