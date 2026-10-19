import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

for (const flags of [
  [],
  ['--test-reporter=tap', '--test-reporter-destination=coverage/probe.tap'],
  ['--test-reporter', 'tap', '--test-reporter-destination', 'coverage/probe.tap'],
  ['--test-concurrency', '2', '--test-name-pattern', 'a customer flow'],
  ['--test-only', '--test-skip-pattern=slow'],
  ['--coverage'],
]) {
  test(`test runner retains the explicit project glob with option-only arguments: ${flags.join(' ') || 'none'}`, async () => {
    const { stdout } = await run(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/node-test-spawn-probe.mjs')).href,
      resolve('scripts/test.mjs'), ...flags]);
    const invocation = JSON.parse(stdout);
    assert.equal(invocation.args.at(-1), 'tests/*.test.ts');
    assert.ok(!invocation.args.includes('--coverage'));
    for (const flag of flags.filter(flag => flag !== '--coverage')) assert.ok(invocation.args.includes(flag));
  });
}

for (const target of ['tests/public-title-search.test.ts', 'tests/*.test.ts']) {
  test(`test runner preserves an explicit target without appending another glob: ${target}`, async () => {
    const { stdout } = await run(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/node-test-spawn-probe.mjs')).href,
      resolve('scripts/test.mjs'), '--test-reporter', 'tap', target]);
    const invocation = JSON.parse(stdout);
    assert.deepEqual(invocation.args.slice(-3), ['--test-reporter', 'tap', target]);
  });
}
