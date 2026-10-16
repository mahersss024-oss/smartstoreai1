import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const lifecycle of ['test:coverage', 'test:db:integration']) {
  test(`test launcher isolates stores and preserves integration opt-in under ${lifecycle}`, () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      npm_lifecycle_event: lifecycle,
      SMARTSTORE_DB_INTEGRATION: '0',
      RUNNER_EXPECT_DATABASE_INTEGRATION: lifecycle === 'test:db:integration' ? '1' : '0',
      SMARTSTORE_MARKETPLACE_STORE: 'file',
      RUNNER_PARENT_DATA_DIR: process.env.SMARTSTORE_DATA_DIR,
    };
    // This is an independent runner, not another Node test-worker IPC child.
    delete env.NODE_TEST_CONTEXT;
    // The assertion below consumes TAP, independent of Node's default reporter.
    const result = spawnSync(process.execPath, ['scripts/test.mjs', '--test-reporter=tap', 'tests/fixtures/test-runner-environment.fixture.ts'], {
      cwd: process.cwd(), env, encoding: 'utf8', timeout: 60_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^# pass 1\s*$/m);
  });
}
