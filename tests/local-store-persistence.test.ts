import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const fixture = join(repositoryRoot, 'tests/fixtures/local-store-persistence.ts');
const fixtureParent = join(repositoryRoot, '.data/project-repair');

function assertContained(directory: string, parent: string) {
  const child = relative(parent, directory);
  assert.ok(child && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function childEnvironment(fixtureRoot: string, dataDirectory?: string) {
  // Keep OS launch requirements, never inherit application credentials/settings.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(name)) {
      env[name] = value;
    }
  }
  Object.assign(env, {
    CI: '1',
    NODE_ENV: 'test',
    DEEPSEEK_API_KEY: 'test-model-placeholder',
    DATABASE_URL: '',
    SMARTSTORE_DB_INTEGRATION: '0',
    SMARTSTORE_MARKETPLACE_STORE: 'file',
    npm_lifecycle_event: 'local-persistence-fixture',
    SMARTSTORE_LOCAL_PERSISTENCE_FIXTURE: '1',
    SMARTSTORE_LOCAL_PERSISTENCE_ROOT: fixtureRoot,
  });
  if (dataDirectory !== undefined) env.SMARTSTORE_DATA_DIR = dataDirectory;
  return env;
}

for (const mode of ['default', 'absolute override', 'relative override'] as const) {
  test(`all local stores persist across processes with ${mode}`, { timeout: 45_000 }, async () => {
    await mkdir(fixtureParent, { recursive: true });
    const fixtureRoot = await mkdtemp(join(fixtureParent, 'persistence-'));
    assertContained(fixtureRoot, fixtureParent);
    const cwd = join(fixtureRoot, 'working-directory');
    await mkdir(cwd);
    const directory = mode === 'default'
      ? undefined
      : mode === 'absolute override'
        ? `  ${join(fixtureRoot, 'overridden-data')}  `
        : '  relative-data/nested  ';
    const expectedDirectory = directory === undefined
      ? join(cwd, '.data')
      : resolve(cwd, directory.trim());
    assertContained(expectedDirectory, fixtureRoot);
    const env = childEnvironment(fixtureRoot, directory);
    const invoke = async (action: 'write' | 'read') => {
      const { stdout } = await run(process.execPath, [
        '--import', pathToFileURL(join(repositoryRoot, 'scripts/testing/isolated-model-provider.mjs')).href,
        join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'),
        '--tsconfig', join(repositoryRoot, 'tsconfig.json'),
        fixture, action,
      ], { cwd, env, timeout: 20_000, maxBuffer: 256 * 1024, windowsHide: true });
      return JSON.parse(stdout) as { pid: number; listingId: string; pushId: string; mobileId: string };
    };

    const written = await invoke('write');
    assert.deepEqual((await readdir(expectedDirectory)).sort(), [
      'marketplace-store.json', 'mobile-push-tokens-store.json', 'push-subscriptions-store.json',
    ]);
    const marketplace = JSON.parse(await readFile(join(expectedDirectory, 'marketplace-store.json'), 'utf8'));
    const push = JSON.parse(await readFile(join(expectedDirectory, 'push-subscriptions-store.json'), 'utf8'));
    const mobile = JSON.parse(await readFile(join(expectedDirectory, 'mobile-push-tokens-store.json'), 'utf8'));
    assert.equal(marketplace.listings.length, 1);
    assert.equal(marketplace.listings[0].id, written.listingId);
    assert.equal(push.subscriptions.length, 1);
    assert.equal(push.subscriptions[0].id, written.pushId);
    assert.equal(mobile.tokens.length, 1);
    assert.equal(mobile.tokens[0].id, written.mobileId);

    const loaded = await invoke('read');
    assert.notEqual(loaded.pid, written.pid);
    assert.deepEqual({ ...loaded, pid: 0 }, { ...written, pid: 0 });
    // Retain only our tiny synthetic artifacts under ignored project storage.
  });
}
