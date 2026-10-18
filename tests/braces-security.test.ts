import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootRequire = createRequire(resolve('package.json'));
const configRequire = createRequire(rootRequire.resolve('eslint-config-next'));
const pluginRequire = createRequire(configRequire.resolve('@next/eslint-plugin-next'));
const globRequire = createRequire(pluginRequire.resolve('fast-glob'));
const matchRequire = createRequire(globRequire.resolve('micromatch'));
const bracesPath = matchRequire.resolve('braces');
const braces = matchRequire('braces');

test('patched braces preserves normal compile, expansion and round-trip behavior', () => {
  assert.equal(braces.compile('src/{app,lib}/**/*.{ts,tsx}'), 'src/(app|lib)/**/*.(ts|tsx)');
  assert.deepEqual(braces.expand('file-{01..03}.{ts,js}'), [
    'file-01.ts', 'file-01.js', 'file-02.ts', 'file-02.js', 'file-03.ts', 'file-03.js',
  ]);
  for (const value of ['{a,{b,c}}', 'literal\\{value\\}', '[{}]', '"{quoted}"', '{unclosed']) {
    assert.equal(typeof braces.stringify(braces.parse(value)), 'string');
  }
  const match = globRequire('micromatch');
  assert.deepEqual(match(['app/page.tsx', 'lib/utils.ts', 'public/logo.png'], '{app,lib}/**/*.{ts,tsx}'),
    ['app/page.tsx', 'lib/utils.ts']);
});

for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  test(`patched braces ${method} rejects deeply nested input without a native stack overflow`, () => {
    const code = `
      const assert = require('node:assert/strict');
      const braces = require(${JSON.stringify(bracesPath)});
      for (const input of ['{'.repeat(4000) + 'a,b' + '}'.repeat(4000), '('.repeat(4000) + 'a' + ')'.repeat(4000)]) {
        assert.throws(() => braces[${JSON.stringify(method)}](input), /safe nesting depth/);
      }
      process.stdout.write('guarded');
    `;
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'guarded');
  });
}

test('AST entry points reject excessive child depth and cycles before recursive traversal', () => {
  let ast: { type: string; nodes?: unknown[]; value?: string } = { type: 'text', value: 'x' };
  for (let index = 0; index < 5000; index++) ast = { type: 'root', nodes: [ast] };
  const cycle: { type: string; nodes: unknown[] } = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const method of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](ast), /safe nesting depth/);
    assert.throws(() => braces[method](cycle), /repeated nodes/);
  }
});

test('advisory is no longer ignored and a version-pinned pnpm patch is configured', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.pnpm?.auditConfig?.ignoreGhsas?.includes('GHSA-vfj7-8cjw-p6xm') ?? false, false);
  assert.ok(pkg.pnpm.patchedDependencies['braces@3.0.3']);
});
