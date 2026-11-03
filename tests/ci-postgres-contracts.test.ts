import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import { createCiPostgresPlan, discoverCiPostgresTests, runCiPostgresContracts, validateCiPostgresEnvironment } from '@/scripts/testing/run-ci-postgres-contracts.mjs';

const valid = { NODE_ENV: 'test' as const, SMARTSTORE_CI_DB_TESTS: '1', DATABASE_URL: 'postgresql://fixture:synthetic@127.0.0.1:55432/smartstore_codex_test?schema=public',
  SMARTSTORE_CONTRACT_CONTEXT_HASH: 'a'.repeat(64) };
// Describe the JS runner's optional argument contract for the TypeScript fixture.
const createPlan = createCiPostgresPlan as (root: string, options: { planPath: string; env: NodeJS.ProcessEnv }) => ReturnType<typeof createCiPostgresPlan>;

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ci-postgres-runner-'));
  t.after(() => {
    assert.ok(root.startsWith(join(tmpdir(), 'ci-postgres-runner-')));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'tests'));
  for (const name of ['sample.db-integration.test.ts', 'db-integration.test.ts', 'evidence-db-integration.test.ts', 'ordinary.test.ts']) {
    writeFileSync(join(root, 'tests', name), 'test fixture');
  }
  return root;
}

test('CI PostgreSQL runner rejects hosted, alternate-port, alternate-database and routing-override URLs before executing', async t => {
  const root = fixture(t);
  let calls = 0;
  for (const env of [
    { ...valid, SMARTSTORE_CI_DB_TESTS: '0' },
    { ...valid, DATABASE_URL: 'postgresql://fixture:must-not-print@hosted.example.invalid:55432/smartstore_codex_test' },
    { ...valid, DATABASE_URL: valid.DATABASE_URL.replace('55432', '5432') },
    { ...valid, DATABASE_URL: valid.DATABASE_URL.replace('smartstore_codex_test', 'smartstore_codex_dev') },
    { ...valid, DATABASE_URL: valid.DATABASE_URL + '&host=hosted.example.invalid' },
  ]) {
    await assert.rejects(runCiPostgresContracts(root, { env, preflight: async () => { calls++; }, execute: async () => { calls++; return 0; } }));
  }
  assert.equal(calls, 0);
  assert.equal(validateCiPostgresEnvironment(valid), valid.DATABASE_URL);
});

test('CI PostgreSQL runner discovers every integration file and refuses arbitrary test plans', t => {
  const root = fixture(t);
  assert.deepEqual(discoverCiPostgresTests(root), ['tests/db-integration.test.ts', 'tests/evidence-db-integration.test.ts', 'tests/sample.db-integration.test.ts']);
  const plan = join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify({ postgresFiles: ['tests/sample.db-integration.test.ts'], serverContextHash: 'b'.repeat(64) }));
  const selected = createPlan(root, { planPath: plan, env: valid });
  assert.equal(selected.files.length, 3, 'A mapped subset must not omit other integration regressions in CI.');
  assert.equal(selected.contextHash, 'b'.repeat(64));
  for (const name of ['tests/ordinary.test.ts', '../outside.db-integration.test.ts', '--test-name-pattern=skip']) {
    writeFileSync(plan, JSON.stringify({ postgresFiles: [name], serverContextHash: 'b'.repeat(64) }));
    assert.throws(() => createPlan(root, { planPath: plan, env: valid }), /only discovered/);
  }
});

test('CI PostgreSQL runner stops on preflight or migration failure and isolates the test child environment', async t => {
  const root = fixture(t);
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  const env = { ...valid, SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'forbidden-storage-key', FIREBASE_PRIVATE_KEY: 'forbidden-push-key',
    GOOGLE_CLIENT_SECRET: 'forbidden-oauth-key', PGHOST: 'hosted.example.invalid', NODE_OPTIONS: '--require=forbidden',
    SMARTSTORE_MARKETPLACE_STORE: 'file', DIRECT_URL: 'postgresql://production.invalid/real' };
  const execute = async (_root: string, args: string[], child: Record<string, string>) => {
    calls.push({ args, env: child });
    if (args.includes('--test')) {
      writeFileSync(join(root, 'coverage/mobile-contract-results-postgres.json'), JSON.stringify({
        contextHash: valid.SMARTSTORE_CONTRACT_CONTEXT_HASH,
        summary: { passed: 3, failed: 0, skipped: 0, todo: 0 },
        tests: discoverCiPostgresTests(root).map(file => ({ file, status: 'passed' })),
      }));
    }
    return 0;
  };
  await assert.rejects(runCiPostgresContracts(root, { env, preflight: async () => { throw new Error('not CREATEDB'); }, execute }));
  assert.equal(calls.length, 0);
  const success = await runCiPostgresContracts(root, { env, preflight: async () => {}, execute });
  assert.equal(success.files, 3);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(0, 3), ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  const child = calls[1].env;
  for (const name of ['SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_CLIENT_SECRET', 'PGHOST', 'NODE_OPTIONS']) assert.equal(child[name], undefined);
  assert.equal(child.DATABASE_URL, valid.DATABASE_URL);
  assert.equal(child.DIRECT_URL, '');
  assert.equal(child.SMARTSTORE_DB_INTEGRATION, '1');
  assert.equal(child.SMARTSTORE_OWNER_RESET_INTEGRATION, '1');
  assert.equal(child.SMARTSTORE_MARKETPLACE_STORE, 'database');
  assert.ok(calls[1].args.includes('--test-concurrency=1'));
  calls.length = 0;
  await assert.rejects(runCiPostgresContracts(root, { env, preflight: async () => {}, execute: async () => { calls.push({ args: [], env: {} }); return 1; } }), /migrations failed/);
  assert.equal(calls.length, 1);
});

test('CI PostgreSQL executable rejects unsafe input without disclosing credentials or contacting the database', () => {
  const child = spawnSync(process.execPath, [resolve('scripts/testing/run-ci-postgres-contracts.mjs')], {
    env: { ...process.env, ...valid, DATABASE_URL: 'postgresql://fixture:private-do-not-print@production.example.invalid:55432/smartstore_codex_test' },
    encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Refusing a database outside/);
  assert.doesNotMatch(child.stderr + child.stdout, /private-do-not-print|production\.example/);
});

test('CI PostgreSQL runner refuses a successful process exit when an integration file was skipped or omitted', async t => {
  const root = fixture(t);
  for (const kind of ['skipped', 'omitted'] as const) {
    await assert.rejects(runCiPostgresContracts(root, {
      env: valid, preflight: async () => {},
      execute: async (_root: string, args: string[]) => {
        if (args.includes('--test')) {
          writeFileSync(join(root, 'coverage/mobile-contract-results-postgres.json'), JSON.stringify({
            contextHash: valid.SMARTSTORE_CONTRACT_CONTEXT_HASH,
            summary: { passed: 2, failed: 0, skipped: kind === 'skipped' ? 1 : 0, todo: 0 },
            tests: discoverCiPostgresTests(root).slice(0, 2).map(file => ({ file, status: 'passed' })),
          }));
        }
        return 0;
      },
    }), /every discovered integration file passed/);
  }
});
