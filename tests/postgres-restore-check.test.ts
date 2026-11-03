import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createRestorePlan, executeRestoreTool, restoreChildEnvironment, runRestoreCheck, validateRestoreSettings } from '@/scripts/dev-tools/postgres-restore-check.mjs';

const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', SMARTSTORE_LOCAL_RESTORE_DRILL: '1', PATH: process.env.PATH,
  DATABASE_URL: 'postgresql://private:do-not-inherit@hosted.example.invalid/production',
  PGHOSTADDR: 'hosted.example.invalid', PGSERVICE: 'production', NODE_OPTIONS: '--require=untrusted',
  FIREBASE_PRIVATE_KEY: 'forbidden-push', AWS_ACCESS_KEY_ID: 'forbidden-storage', GOOGLE_CLIENT_SECRET: 'forbidden-oauth' };
const settings = { host: '127.0.0.1', port: 55432, user: 'codex_local', password: 'synthetic-fixture-password' };
const token = 'a'.repeat(24);
type Call = { program: string; args: string[]; child: Record<string, string>; phase: string };

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'smartstore-restore-runner-'));
  t.after(() => {
    assert.ok(root.startsWith(join(tmpdir(), 'smartstore-restore-runner-')));
    rmSync(root, { recursive: true, force: true });
  });
  const plan = createRestorePlan(root, token);
  mkdirSync(plan.cluster, { recursive: true }); writeFileSync(join(plan.cluster, 'PG_VERSION'), '17');
  const bin = join(root, 'bin'); mkdirSync(bin);
  for (const name of ['pg_ctl', 'psql', 'pg_dump', 'pg_restore']) writeFileSync(join(bin, `${name}.exe`), 'inert test fixture');
  const migration = join(root, 'prisma/migrations/20260101000000_fixture');
  mkdirSync(migration, { recursive: true }); writeFileSync(join(migration, 'migration.sql'), 'SELECT 1;');
  return { root, bin, plan };
}

function fakeRuntime(t: TestContext, options: { running?: boolean; failPhase?: string; differentData?: boolean; differentCatalog?: boolean } = {}) {
  const fixtureFiles = fixture(t);
  const calls: Call[] = [];
  let running = options.running ?? false;
  const databases = new Set<string>();
  const counts = { User: 2, Listing: 1, ListingImage: 1, Conversation: 1, ConversationMessage: 1,
    Favorite: 1, Commission: 1, Report: 1, EvidenceCase: 1, EvidenceAsset: 2, EvidenceEvent: 1, _prisma_migrations: 1 };
  const catalog = { tables: Object.keys(counts), functions: [{ name: 'evidence_immutable' }], triggers: [{ enabled: 'O' }] };
  const data = Object.fromEntries(Object.entries(counts).map(([name, rows]) => [name, { rows, sha256: 'a'.repeat(64) }]));
  const execute = async (program: string, args: string[], child: Record<string, string>, _cwd: string, _timeout: number, phase: string) => {
    calls.push({ program, args, child, phase });
    if (phase === options.failPhase) return { code: 1, stdout: '', stderr: 'synthetic private native diagnostics' };
    let stdout = '';
    if (phase === 'cluster-status' || phase === 'cluster-final-status' || phase === 'cluster-cleanup-status') return { code: running ? 0 : 3, stdout, stderr: '' };
    if (phase === 'cluster-start') running = true;
    if (phase === 'cluster-stop') running = false;
    if (phase === 'cluster-identity') stdout = JSON.stringify({ database: 'postgres', user: 'codex_local', directory: fixtureFiles.plan.cluster,
      port: '55432', listen: '127.0.0.1', version: '17.11', versionNumber: 170011, createDatabase: true });
    if (phase === 'dump-version') stdout = 'pg_dump (PostgreSQL) 17.11';
    if (phase === 'source-create') databases.add(fixtureFiles.plan.source);
    if (phase === 'target-create') databases.add(fixtureFiles.plan.target);
    if (phase === 'source-catalog' || phase === 'target-catalog') stdout = JSON.stringify({ ...catalog,
      ...(phase === 'target-catalog' && options.differentCatalog ? { triggers: [] } : {}) });
    if (phase === 'source-data' || phase === 'target-data') stdout = JSON.stringify({ ...data,
      ...(phase === 'target-data' && options.differentData ? { Listing: { rows: 1, sha256: 'b'.repeat(64) } } : {}) });
    if (phase === 'source-dump') writeFileSync(args[args.indexOf('--file') + 1], 'PGDMP synthetic-only test archive');
    if (phase === 'cleanup-database') {
      const query = readFileSync(args.at(-1)!, 'utf8');
      const database = [...databases].find(name => query.includes(`"${name}"`));
      assert.ok(database); databases.delete(database);
    }
    if (phase === 'verify-cleanup') stdout = `${databases.size}`;
    return { code: 0, stdout, stderr: '' };
  };
  return { ...fixtureFiles, calls, databases, execute, isRunning: () => running };
}

test('restore drill requires explicit opt-in and rejects remote settings before any command executes', async () => {
  let commands = 0;
  const execute = async () => { commands++; return { code: 0, stdout: '', stderr: '' }; };
  await assert.rejects(runRestoreCheck('nonexistent-fixture', { env: { ...env, SMARTSTORE_LOCAL_RESTORE_DRILL: '0' }, execute }), /SMARTSTORE_LOCAL_RESTORE_DRILL/);
  for (const invalid of [
    { ...settings, host: 'hosted.example.invalid' }, { ...settings, host: 'localhost' },
    { ...settings, port: 5432 }, { ...settings, user: 'production' }, { ...settings, password: '' },
  ]) {
    await assert.rejects(runRestoreCheck('nonexistent-fixture', { env, settings: invalid, execute }), /Refusing settings/);
    assert.throws(() => validateRestoreSettings(invalid), /Refusing settings/);
  }
  assert.equal(commands, 0);
});

test('restore drill creates only generated disposable names and discards inherited production services', () => {
  for (const invalid of ['../escape', 'a'.repeat(23), 'g'.repeat(24), 'a'.repeat(24) + ';DROP DATABASE postgres']) assert.throws(() => createRestorePlan('.', invalid));
  const plan = createRestorePlan('.', token);
  assert.match(plan.source, /^smartstore_restore_source_[a-f0-9]{24}$/);
  assert.match(plan.target, /^smartstore_restore_target_[a-f0-9]{24}$/);
  const child = restoreChildEnvironment(env, settings, plan.source);
  for (const key of ['NODE_OPTIONS', 'PGSERVICE', 'FIREBASE_PRIVATE_KEY', 'AWS_ACCESS_KEY_ID', 'GOOGLE_CLIENT_SECRET']) assert.equal((child as Record<string, unknown>)[key], undefined);
  assert.equal(child.PGHOSTADDR, '127.0.0.1');
  assert.equal(child.PGPASSWORD, settings.password);
  assert.equal(new URL(child.DATABASE_URL).pathname, `/${plan.source}`);
  assert.equal(child.DIRECT_URL, '');
  for (const database of ['smartstore_codex_dev', 'smartstore_codex_test', 'sm', '../escape']) assert.throws(() => restoreChildEnvironment(env, settings, database));
});

test('restore drill migrates a fresh source, restores its custom dump, verifies data and guards, and cleans up its cluster', async t => {
  const runtime = fakeRuntime(t);
  const receipt = await runRestoreCheck(runtime.root, { env, settings, token, postgresBin: runtime.bin, execute: runtime.execute });
  assert.equal(receipt.status, 'passed');
  for (const key of ['catalogMatches', 'allTableDataMatches', 'restoredGuardsPassed', 'temporaryDatabasesRemoved', 'clusterStateRestored'] as const) assert.equal(receipt[key], true);
  assert.equal(receipt.productionAccess, false);
  assert.equal(receipt.existingApplicationRowsRead, false);
  assert.equal(runtime.databases.size, 0); assert.equal(runtime.isRunning(), false);
  assert.equal(existsSync(runtime.plan.directory), false);
  const phases = runtime.calls.map(call => call.phase);
  assert.ok(phases.indexOf('source-migrations') < phases.indexOf('source-dump'));
  assert.ok(phases.indexOf('source-dump') < phases.indexOf('target-restore'));
  assert.equal(runtime.calls.filter(call => call.phase === 'cleanup-database').length, 2);
  const restore = runtime.calls.find(call => call.phase === 'target-restore')!;
  for (const flag of ['--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction']) assert.ok(restore.args.includes(flag));
  const migration = runtime.calls.find(call => call.phase === 'source-migrations')!;
  assert.equal(new URL(migration.child.DATABASE_URL).pathname, `/${runtime.plan.source}`);
  assert.ok(runtime.calls.every(call => !call.args.includes('smartstore_codex_dev') && !call.args.includes('smartstore_codex_test')));
  assert.ok(runtime.calls.some(call => call.phase === 'target-guard-checks'));
  assert.ok(runtime.calls.filter(call => call.program.endsWith('psql.exe')).every(call => call.args.includes('-f')));
  const saved = readFileSync(runtime.plan.receipt, 'utf8');
  assert.equal(JSON.parse(saved).status, 'passed');
  assert.doesNotMatch(saved, /synthetic-fixture-password|do-not-inherit|private native diagnostics|postgresql:\/\//);
});

test('restore drill rejects changed data or schema and always removes both temporary databases without stopping an initially running cluster', async t => {
  for (const kind of ['data', 'catalog', 'restore'] as const) {
    const runtime = fakeRuntime(t, { running: true, differentData: kind === 'data', differentCatalog: kind === 'catalog', failPhase: kind === 'restore' ? 'target-restore' : undefined });
    await assert.rejects(runRestoreCheck(runtime.root, { env, settings, token, postgresBin: runtime.bin, execute: runtime.execute }),
      /fingerprint differs|failed at target-restore/);
    assert.equal(runtime.databases.size, 0);
    assert.equal(runtime.isRunning(), true);
    assert.equal(runtime.calls.some(call => call.phase === 'cluster-stop'), false);
    assert.equal(existsSync(runtime.plan.directory), false);
    const receipt = JSON.parse(readFileSync(runtime.plan.receipt, 'utf8'));
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.temporaryDatabasesRemoved, true); assert.equal(receipt.clusterStateRestored, true);
  }
});

test('restore executable refuses to start without opt-in and never prints an inherited production connection', () => {
  const child = spawnSync(process.execPath, [resolve('scripts/dev-tools/postgres-restore-check.mjs')], {
    env: { ...process.env, ...env, SMARTSTORE_LOCAL_RESTORE_DRILL: '0', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /SMARTSTORE_LOCAL_RESTORE_DRILL/);
  assert.doesNotMatch(child.stdout + child.stderr, /do-not-inherit|hosted\.example|synthetic-fixture-password/);
});

test('cluster startup does not wait for a running server to release inherited output pipes', { timeout: 15_000 }, async t => {
  const { root } = fixture(t);
  const pidFile = join(root, 'synthetic-background-process.pid');
  const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:['ignore',1,2],windowsHide:true});require('node:fs').writeFileSync(process.argv[1],String(child.pid));child.unref();`;
  try {
    const result = await executeRestoreTool(process.execPath, ['-e', script, pidFile], { ...process.env, NODE_OPTIONS: '' }, process.cwd(), 10_000, 'cluster-start');
    assert.equal(result.code, 0, 'Only the launcher exit is required, while the synthetic server still owns its inherited pipes.');
  } finally {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, 'utf8'));
      assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
      try { process.kill(pid); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  }
});

test('restore drill rejects redirected directories and conceals malformed local credential contents before spawning tools', async t => {
  const redirected = fixture(t);
  const outside = join(redirected.root, 'outside-recovery-state'); mkdirSync(outside);
  symlinkSync(outside, join(redirected.plan.state, 'restore-drills'), 'junction');
  let commands = 0;
  const execute = async () => { commands++; return { code: 0, stdout: '', stderr: '' }; };
  await assert.rejects(runRestoreCheck(redirected.root, { env, settings, token, postgresBin: redirected.bin, execute }), /redirected local recovery directory/);
  assert.deepEqual(readdirSync(outside), []);
  const malformed = fixture(t);
  writeFileSync(join(malformed.plan.state, 'local.json'), '{"password":PRIVATE_FIXTURE_CREDENTIAL}');
  await assert.rejects(runRestoreCheck(malformed.root, { env, token, postgresBin: malformed.bin, execute }), error => {
    assert.match((error as Error).message, /settings are unavailable or invalid/);
    assert.doesNotMatch((error as Error).message, /PRIVATE_FIXTURE_CREDENTIAL/); return true;
  });
  assert.equal(commands, 0);
});
