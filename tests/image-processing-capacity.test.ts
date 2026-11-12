import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageProcessingGate, ImageProcessingCapacityError } from '@/agent/marketplace/image-processing-capacity';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('bounded processing queues fairly and rejects overload without starting its work', async () => {
  const gate = createImageProcessingGate({ concurrent: 1, queued: 1, waitMs: 1000 });
  const hold = deferred(); const starts: string[] = [];
  const first = gate.run(async () => { starts.push('first'); await hold.promise; });
  const second = gate.run(async () => { starts.push('second'); return 2; });
  await assert.rejects(gate.run(async () => { starts.push('rejected'); }), ImageProcessingCapacityError);
  assert.deepEqual(starts, ['first']); hold.resolve();
  await first; assert.equal(await second, 2); assert.deepEqual(starts, ['first', 'second']);
});

test('expired queued work is never started later and does not strand capacity', async () => {
  const gate = createImageProcessingGate({ concurrent: 1, queued: 1, waitMs: 15 });
  const hold = deferred(); let expiredStarted = false;
  const first = gate.run(() => hold.promise);
  await assert.rejects(gate.run(async () => { expiredStarted = true; }), ImageProcessingCapacityError);
  hold.resolve(); await first;
  assert.equal(await gate.run(async () => 3), 3); assert.equal(expiredStarted, false);
});

test('failed image work releases its permit for the next operation', async () => {
  const gate = createImageProcessingGate({ concurrent: 1, queued: 1, waitMs: 1000 });
  const hold = deferred();
  const failed = gate.run(async () => { await hold.promise; throw new Error('bad bytes'); });
  const next = gate.run(async () => 'ready'); hold.resolve();
  await assert.rejects(failed, /bad bytes/); assert.equal(await next, 'ready');
});
