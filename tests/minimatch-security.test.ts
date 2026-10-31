import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';

type Options = Record<string, unknown>;
type Matcher = { match(path: string): boolean; set: unknown[] };
type MinimatchApi = {
  (path: string, pattern: string, options?: Options): boolean;
  minimatch: MinimatchApi;
  Minimatch: new (pattern: string, options?: Options) => Matcher;
  defaults(options: Options): MinimatchApi;
  filter(pattern: string, options?: Options): (path: string) => boolean;
  braceExpand(pattern: string, options?: Options): string[];
};

const rootRequire = createRequire(resolve('package.json'));
const eslintRequire = createRequire(rootRequire.resolve('eslint'));
const nextRequire = createRequire(rootRequire.resolve('eslint-config-next'));
const importRequire = createRequire(nextRequire.resolve('eslint-plugin-import'));
const parserRequire = createRequire(importRequire.resolve('@typescript-eslint/parser'));
const consumers = [
  ['eslint', eslintRequire],
  ['@eslint/config-array', createRequire(eslintRequire.resolve('@eslint/config-array'))],
  ['@eslint/eslintrc', createRequire(eslintRequire.resolve('@eslint/eslintrc'))],
  ['eslint-plugin-import', importRequire],
  ['eslint-plugin-react', createRequire(nextRequire.resolve('eslint-plugin-react'))],
  ['eslint-plugin-jsx-a11y', createRequire(nextRequire.resolve('eslint-plugin-jsx-a11y'))],
  ['@typescript-eslint/typescript-estree', createRequire(parserRequire.resolve('@typescript-eslint/typescript-estree'))],
] as const;

test('every installed lint consumer resolves the patched minimatch release with no audit exemption', () => {
  const entries = new Set<string>();
  for (const [name, consumer] of consumers) {
    const manifest = JSON.parse(readFileSync(consumer.resolve('minimatch/package.json'), 'utf8'));
    assert.equal(manifest.version, '11.0.1', name);
    const entry = consumer.resolve('minimatch');
    assert.match(entry.replaceAll('\\', '/'), /\/dist\/commonjs\/legacy\.cjs$/, name);
    entries.add(entry);
  }
  assert.equal(entries.size, 1, 'Legacy and modern lint consumers share one fixed implementation');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(manifest.pnpm.overrides['minimatch@<11.0.1'], '11.0.1');
  assert.ok(manifest.pnpm.patchedDependencies['minimatch@11.0.1']);
  assert.equal(manifest.pnpm.auditConfig?.ignoreGhsas, undefined);
  assert.equal(manifest.pnpm.auditConfig?.ignoreCves, undefined);
  assert.doesNotMatch(readFileSync('pnpm-lock.yaml', 'utf8'), /^\s+minimatch@(?:3|9|10)\./m);
  assert.match(readFileSync('.github/workflows/production-gate.yml', 'utf8'), /run: pnpm audit --audit-level moderate/);
});

test('legacy callable minimatch and modern named helpers retain file matching behavior', () => {
  for (const [name, consumer] of consumers) {
    const api = consumer('minimatch') as MinimatchApi;
    assert.equal(typeof api, 'function', name);
    assert.equal(api.minimatch, api, name);
    const cases: Array<[string, string, boolean, Options?]> = [
      ['src/nested/page.tsx', '**/*.{ts,tsx}', true],
      ['src/nested/page.js', '**/*.{ts,tsx}', false],
      ['src/page.ts', 'src/@(page|layout).ts', true],
      ['src/other.ts', 'src/@(page|layout).ts', false],
      ['src/page.ts', '!**/*.test.ts', true],
      ['src/page.test.ts', '!**/*.test.ts', false],
      ['.hidden/page.ts', '**/*.ts', false],
      ['.hidden/page.ts', '**/*.ts', true, { dot: true }],
      ['app/listings/[listingId]/page.tsx', 'app/listings/[[]listingId]/page.tsx', true],
      ['app/listings/x/page.tsx', 'app/listings/[[]listingId]/page.tsx', false],
      ['سوق/إعلان.ts', '**/*.ts', true],
      ['SRC/PAGE.TS', 'src/*.ts', false, { nocase: false }],
      ['SRC/PAGE.TS', 'src/*.ts', true, { nocase: true }],
      ['src\\nested\\page.ts', 'src\\**\\*.ts', true, { platform: 'win32', windowsPathsNoEscape: true }],
    ];
    for (const [path, pattern, expected, options] of cases) {
      assert.equal(api(path, pattern, options), expected, `${name}: ${path} against ${pattern}`);
      assert.equal(new api.Minimatch(pattern, options).match(path), expected, `${name}: constructor ${pattern}`);
    }
    assert.deepEqual(api.braceExpand('src/*.{ts,tsx}'), ['src/*.ts', 'src/*.tsx']);
    assert.deepEqual(['a.ts', 'b.js', 'c.tsx'].filter(api.filter('*.{ts,tsx}')), ['a.ts', 'c.tsx']);
    const defaults = api.defaults({ nocase: true });
    assert.equal(defaults('PAGE.TS', '*.ts'), true);
    assert.equal(new defaults.Minimatch('*.ts').match('PAGE.TS'), true);
  }
});

test('the upstream ESM entry preserves modern named exports independently of the CommonJS bridge', async () => {
  const manifestPath = eslintRequire.resolve('minimatch/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = resolve(dirname(manifestPath), manifest.exports['.'].import.default);
  assert.match(entry.replaceAll('\\', '/'), /\/dist\/esm\/index\.js$/);
  const api = await import(pathToFileURL(entry).href);
  assert.equal(typeof api.minimatch, 'function');
  assert.equal(api.minimatch('app/page.tsx', '**/*.{ts,tsx}'), true);
  assert.equal(new api.Minimatch('**/*.ts').match('lib/example.ts'), true);
  assert.deepEqual(['a.ts', 'b.js'].filter(api.filter('*.ts')), ['a.ts']);
});

test('the advisory globparts amplification pattern is bounded inside a disposable child process', () => {
  // Upstream regression: github.com/isaacs/minimatch/commit/77a0f5c
  // Keep adversarial compilation outside the test runner with a hard process
  // timeout and memory ceiling so a regression cannot hang CI or exhaust it.
  const script = `
    const assert = require('node:assert/strict');
    const { Minimatch } = require(process.argv[1]);
    const pattern = Array(30).fill('**/../a/b').join('/');
    const matcher = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
    assert.equal(matcher.set.length, 64);
    const small = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
    assert.equal(small.set.length, 4);
    assert.equal(small.match('../a/b/../c/d'), true);
    assert.equal(small.match('x/a/b/y/c/d'), true);
    const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
    assert.equal(large.set.length, 2000);
    assert.equal(large.match('y/999'), true);
    process.stdout.write('bounded');
  `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', script, eslintRequire.resolve('minimatch')], {
    timeout: 5000, encoding: 'utf8', windowsHide: true, maxBuffer: 256_000,
  });
  assert.equal(child.error, undefined, 'Adversarial pattern compilation must finish within five seconds');
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'bounded');
});

test('actual ESLint glob selection and ignore patterns still enforce rules after the minimatch upgrade', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'smartstore-minimatch-eslint-'));
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: [
    { ignores: ['ignored/**', '**/*.generated.js'] },
    { files: ['**/*.{js,jsx}'], rules: { 'no-undef': 'error' } },
  ] });
  assert.equal(await eslint.isPathIgnored(join(cwd, 'src/page.js')), false);
  assert.equal(await eslint.isPathIgnored(join(cwd, 'ignored/page.js')), true);
  assert.equal(await eslint.isPathIgnored(join(cwd, 'src/page.generated.js')), true);
  const [checked] = await eslint.lintText('missingName;', { filePath: join(cwd, 'src/page.js') });
  assert.equal(checked.errorCount, 1);
  assert.equal(checked.messages[0].ruleId, 'no-undef');
  const [ignored] = await eslint.lintText('missingName;', { filePath: join(cwd, 'ignored/page.js') });
  assert.equal(ignored.errorCount, 0);
  assert.ok(ignored.messages.some(message => message.message.includes('ignored')));
});

test('React lint rules can call the legacy minimatch function for property and component patterns', async () => {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    files: ['**/*.jsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react: nextRequire('eslint-plugin-react') },
    rules: { 'react/forbid-component-props': ['error', { forbid: [
      { propNamePattern: 'data-*', allowedForPatterns: ['Allowed*'] },
    ] }] },
  }] });
  const [result] = await eslint.lintText('<><Panel data-id="one" /><AllowedPanel data-id="two" /></>;', {
    filePath: 'minimatch-consumer-fixture.jsx',
  });
  assert.equal(result.errorCount, 1);
  assert.equal(result.messages[0].ruleId, 'react/forbid-component-props');
  assert.match(result.messages[0].message, /data-id/);
});
