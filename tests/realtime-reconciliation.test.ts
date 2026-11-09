import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('a healthy event stream reconciles missed cross-instance changes and reconnects without polling hidden pages', async () => {
  const effects: Array<() => void | (() => void)> = [], intervals = new Map<number, () => void>();
  const reasons: string[] = [];
  let online = true, visibility = 'visible', sequence = 0;
  const streams: Array<{ onopen?: () => void; onerror?: () => void; close: () => void }> = [];
  const loaded = { exports: {} as { useSmartstoreRealtime: (options: unknown) => void } };
  const code = ts.transpileModule(readFileSync('lib/realtime/use-smartstore-realtime.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, URLSearchParams, Set,
    require: (name: string) => {
      if (name === 'react') return { useEffect: (effect: typeof effects[number]) => effects.push(effect),
        useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, () => {}] };
      if (name === '@/lib/client-idle-task') return { scheduleIdleTask: (fn: () => void) => { fn(); return () => {}; } };
      throw new Error('Unexpected import: ' + name);
    },
    EventSource: class { constructor() { streams.push(this); } close() {} addEventListener() {} },
    navigator: { get onLine() { return online; } },
    document: { get visibilityState() { return visibility; }, addEventListener() {}, removeEventListener() {} },
    window: { setInterval: (fn: () => void) => { intervals.set(++sequence, fn); return sequence; },
      clearInterval: (id: number) => intervals.delete(id), addEventListener() {}, removeEventListener() {} },
  });
  loaded.exports.useSmartstoreRealtime({ onResync: ({ reason }: { reason: string }) => reasons.push(reason) });
  const cleanups = effects.map(effect => effect());
  streams[0].onopen!(); await Promise.resolve();
  assert.deepEqual(reasons, ['connected']);
  for (const timer of intervals.values()) timer(); await Promise.resolve();
  assert.deepEqual(reasons, ['connected', 'reconcile']);
  visibility = 'hidden';
  for (const timer of intervals.values()) timer(); await Promise.resolve();
  online = false; visibility = 'visible';
  for (const timer of intervals.values()) timer(); await Promise.resolve();
  assert.equal(reasons.length, 2);
  online = true; streams[0].onopen!(); await Promise.resolve();
  assert.equal(reasons.at(-1), 'connected');
  for (const cleanup of cleanups) if (cleanup) cleanup();
  assert.equal(intervals.size, 0);
});
