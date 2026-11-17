import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';

const rootRequire = createRequire(resolve('package.json'));
const configRequire = createRequire(rootRequire.resolve('eslint-config-next'));
const pluginRequire = createRequire(configRequire.resolve('@next/eslint-plugin-next'));
const glob = pluginRequire('fast-glob');
const { getRootDirs } = pluginRequire('./utils/get-root-dirs');

test('lint glob consumers share the replacement and the vulnerable packages are absent from the lockfile', () => {
  const parserRequire = createRequire(configRequire.resolve('@typescript-eslint/parser'));
  const estreeRequire = createRequire(parserRequire.resolve('@typescript-eslint/typescript-estree'));
  const resolverRequire = createRequire(configRequire.resolve('eslint-import-resolver-typescript'));
  const entry = pluginRequire.resolve('fast-glob');
  assert.match(entry.replaceAll('\\', '/'), /\/smartstore-lint-glob\/index\.cjs$/);
  assert.equal(estreeRequire.resolve('tinyglobby'), entry);
  assert.equal(resolverRequire.resolve('tinyglobby'), entry);
  const lock = readFileSync('pnpm-lock.yaml', 'utf8');
  assert.doesNotMatch(lock, /^\s+(?:braces|micromatch|fast-glob|picomatch|tinyglobby)@/m);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.pnpm.overrides['@next/eslint-plugin-next@16.4.0>fast-glob'], 'file:tooling/lint-glob');
  assert.deepEqual(Object.keys(pkg.pnpm.patchedDependencies).sort(), ['@next/eslint-plugin-next@16.4.0', 'minimatch@11.0.1']);
  assert.equal(pkg.pnpm.auditConfig?.ignoreGhsas, undefined);
});

test('Next.js globSync directory discovery preserves default, literal, glob and array roots', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'smartstore-lint-glob-'));
  const apps = join(cwd, 'apps');
  for (const name of ['store', 'admin', 'سوق']) mkdirSync(join(apps, name), { recursive: true });
  writeFileSync(join(apps, 'not-a-directory.ts'), 'export {};');
  const normalize = (paths: string[]) => paths.map(path => path.replaceAll('\\', '/').replace(/\/$/, '')).sort();
  const discover = (rootDir?: string | string[]) => getRootDirs({ cwd, settings: { next: { rootDir } } });
  assert.deepEqual(discover(), [cwd]);
  assert.deepEqual(normalize(discover(join(apps, 'store'))), normalize([join(apps, 'store')]));
  assert.deepEqual(normalize(discover(join(apps, '*'))), normalize(['store', 'admin', 'سوق'].map(name => join(apps, name))));
  assert.deepEqual(normalize(discover(join(apps, '{store,admin}'))), normalize([join(apps, 'store'), join(apps, 'admin')]));
  assert.deepEqual(normalize(discover([join(apps, 'store'), join(apps, 'سوق')])), normalize([join(apps, 'store'), join(apps, 'سوق')]));
  assert.deepEqual(discover(join(apps, 'missing-*')), []);
  assert.deepEqual(normalize(glob.globSync(['apps/*', '!apps/admin'], { cwd, onlyDirectories: true })), ['apps/store', 'apps/سوق']);
});

test('TypeScript config discovery handles literal roots, wildcard projects and ignored directories', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'smartstore-lint-projects-'));
  for (const name of ['web', 'ignored', '.internal']) {
    mkdirSync(join(cwd, name));
    writeFileSync(join(cwd, name, 'tsconfig.json'), '{}');
  }
  assert.equal(glob.isDynamicPattern('web/tsconfig.json'), false);
  assert.equal(glob.isDynamicPattern('{web,other}/tsconfig.json'), true);
  assert.deepEqual(glob.globSync('*/tsconfig.json', {
    cwd, dot: true, expandDirectories: false, ignore: ['ignored/**'],
  }).sort(), ['.internal/tsconfig.json', 'web/tsconfig.json']);
  assert.deepEqual(glob.globSync('web', { cwd }), ['web/tsconfig.json']);
});

test('effective ESLint rules match the pre-replacement baseline for TSX and TypeScript', async () => {
  const eslint = new ESLint();
  for (const file of ['app/listings/[listingId]/page.tsx', 'agent/marketplace/search.ts']) {
    const config = await eslint.calculateConfigForFile(file);
    const rules = Object.entries(config.rules).sort(([a], [b]) => a.localeCompare(b));
    assert.equal(rules.length, 113);
    assert.equal(createHash('sha256').update(JSON.stringify(rules)).digest('hex'),
      'f37f3ecf68521bceb640dd9bc7d379a25e14881f92adf8c4a3da657a52a28d91');
  }
});

test('real Next.js lint rules still detect unsafe script imports after replacement', async () => {
  const eslint = new ESLint({ overrideConfig: { settings: { next: { rootDir: process.cwd() } } } });
  const [result] = await eslint.lintText('export default function Page(){return <script src="https://example.test/script.js" />;}',
    { filePath: 'app/security-lint-fixture.tsx' });
  assert.ok(result.messages.some(message => message.ruleId === '@next/next/no-sync-scripts'));
});
