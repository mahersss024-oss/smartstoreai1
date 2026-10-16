import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run the Node test runner with an isolated marketplace data directory so
// parallel test files never race on a shared `.data/marketplace-store.json`.
// The override is read by the store at import time, so it must be present in
// the child process environment from the very start.

function loadEnvFile(path) {
  let content = '';

  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'));

const dataDir = mkdtempSync(join(tmpdir(), 'smartstore-test-data-'));
const coverage = process.argv.includes('--coverage');
const testTargets = process.argv.slice(2).filter(argument => argument !== '--coverage');
const patterns = testTargets.length > 0 ? testTargets : ['tests/*.test.ts'];
const coverageOptions = coverage ? [
  '--experimental-test-coverage',
  ...['agent/**', 'app/**', 'components/**', 'hooks/**', 'lib/**', 'public/**', 'scripts/**', 'proxy.ts', 'next.config.ts']
    .map(pattern => `--test-coverage-include=${pattern}`),
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=./scripts/testing/coverage-reporter.mjs',
  '--test-reporter-destination=coverage/unit-summary.json',
] : [];
if (coverage) mkdirSync('coverage', { recursive: true });
const child = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', '--test', ...coverageOptions, ...patterns],
  {
    env: {
      ...process.env,
      // Stores use the test lifecycle to disable persistence between test cases.
      npm_lifecycle_event: 'test',
      ...(process.env.npm_lifecycle_event === 'test:db:integration'
        ? { SMARTSTORE_DB_INTEGRATION: '1' } : {}),
      SMARTSTORE_DATA_DIR: dataDir,
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
