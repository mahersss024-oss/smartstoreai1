import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

function assertTraceDisabled(source: string) {
  const parsed = ts.createSourceFile('performance.spec.ts', source, ts.ScriptTarget.Latest, true);
  const traceModes: Array<string | undefined> = [];
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!ts.isPropertyAccessExpression(call.expression)
      || !ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== 'test'
      || call.expression.name.text !== 'use') continue;
    const options = call.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) continue;
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property)
        || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        || property.name.text !== 'trace') continue;
      traceModes.push(ts.isStringLiteral(property.initializer) ? property.initializer.text : undefined);
    }
  }
  assert.ok(traceModes.length > 0, 'performance specs must explicitly disable trace capture');
  assert.ok(traceModes.every(mode => mode === 'off'), 'performance specs must keep trace capture off');
}

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
  for (const source of [vitals, stability]) assertTraceDisabled(source);
  assert.match(vitals, /vitals\.lcp[^\n]+\.toBeLessThanOrEqual\(2500\)/);
  assert.match(vitals, /vitals\.interactionMax[^\n]+\.toBeLessThanOrEqual\(200\)/);
  assert.match(stability, /vitals\.inp[\s\S]*?toBeLessThanOrEqual\(\s*200,/);
});

test('trace guard accepts other options and formatting but requires an actual disabled trace option', () => {
  for (const source of [
    "test.use({ trace: 'off', serviceWorkers: 'block' });",
    'test.use({\n  serviceWorkers: "block",\n  "trace": "off",\n});',
  ]) assert.doesNotThrow(() => assertTraceDisabled(source));
  for (const source of [
    "// test.use({ trace: 'off' });",
    'const example = "test.use({ trace: \'off\' });";',
    "test.use({ serviceWorkers: 'block' });",
    "test.use({ trace: 'on', serviceWorkers: 'block' });",
    "test.use({ trace: 'off' }); test.use({ trace: 'on' });",
  ]) assert.throws(() => assertTraceDisabled(source));
});
