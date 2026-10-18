import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('test provider isolation blocks live model transport but preserves ordinary fetch', () => {
  const child = spawnSync(process.execPath, [
    '--import', pathToFileURL(resolve('scripts/testing/isolated-model-provider.mjs')).href, '--input-type=module', '-e', `
      const model = await fetch('https://api.deepseek.com/chat/completions');
      const local = await fetch('data:text/plain,local-pass-through');
      console.log(JSON.stringify({ status: model.status, code: (await model.json()).error.code,
        ordinaryFetch: await local.text() }));
    `,
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  assert.deepEqual(JSON.parse(child.stdout), {
    status: 401, code: 'test_model_provider_disabled', ordinaryFetch: 'local-pass-through',
  });
});

test('performance specs avoid trace frame capture without relaxing their timing budgets', () => {
  const vitals = readFileSync('e2e/all-pages-vitals.spec.ts', 'utf8');
  const stability = readFileSync('e2e/performance-stability.spec.ts', 'utf8');
  for (const source of [vitals, stability]) assert.match(source, /test\.use\(\{ trace: 'off' \}\)/);
  assert.match(vitals, /vitals\.lcp[^\n]+\.toBeLessThanOrEqual\(2500\)/);
  assert.match(vitals, /vitals\.interactionMax[^\n]+\.toBeLessThanOrEqual\(200\)/);
  assert.match(stability, /vitals\.inp[\s\S]*?toBeLessThanOrEqual\(\s*200,/);
});
