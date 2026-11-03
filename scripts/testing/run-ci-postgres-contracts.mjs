import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const databaseName = 'smartstore_codex_test';
const allowedFilename = /(?:\.db-integration\.test\.ts$|^(?:db-integration|evidence-db-integration)\.test\.ts$)/;
const contextPattern = /^[a-f0-9]{64}$/;

export function validateCiPostgresEnvironment(env) {
  if (env.SMARTSTORE_CI_DB_TESTS !== '1') throw new Error('Set SMARTSTORE_CI_DB_TESTS=1 only for the dedicated disposable PostgreSQL test service.');
  let database;
  try { database = new URL(env.DATABASE_URL ?? ''); }
  catch { throw new Error('A dedicated PostgreSQL test DATABASE_URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' ||
    database.port !== '55432' || database.pathname !== `/${databaseName}` || database.hash ||
    [...database.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) {
    throw new Error('Refusing a database outside 127.0.0.1:55432/smartstore_codex_test with public schema.');
  }
  return database.toString();
}

export function discoverCiPostgresTests(root) {
  return readdirSync(join(root, 'tests'), { withFileTypes: true })
    .filter(entry => entry.isFile() && allowedFilename.test(entry.name))
    .map(entry => `tests/${entry.name}`).sort();
}

function withinRoot(root, file) {
  const relation = relative(realpathSync(root), realpathSync(file));
  return relation !== '..' && !relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(relation);
}

export function createCiPostgresPlan(root, { planPath, env = process.env } = {}) {
  // Validate the destination before imports, connections, migrations, or child processes.
  const databaseUrl = validateCiPostgresEnvironment(env);
  const files = discoverCiPostgresTests(root);
  if (!files.length) throw new Error('No committed PostgreSQL integration test files were discovered.');
  let contextHash = env.SMARTSTORE_CONTRACT_CONTEXT_HASH;
  if (planPath) {
    const fullPlanPath = resolve(root, planPath);
    if (!existsSync(fullPlanPath) || !withinRoot(root, fullPlanPath)) throw new Error('The PostgreSQL contract plan must be a file inside this checkout.');
    const plan = JSON.parse(readFileSync(fullPlanPath, 'utf8'));
    if (!Array.isArray(plan.postgresFiles) || plan.postgresFiles.length === 0 ||
      plan.postgresFiles.some(file => typeof file !== 'string' || !files.includes(file))) {
      throw new Error('The contract plan may reference only discovered PostgreSQL integration test files.');
    }
    contextHash = plan.serverContextHash;
  }
  if (!contextPattern.test(contextHash ?? '')) throw new Error('A valid server source-context SHA-256 hash is required for test receipts.');
  return { databaseUrl, files, contextHash };
}

export function ciPostgresChildEnvironment(root, env, plan) {
  const clean = { ...env };
  for (const name of Object.keys(clean)) {
    if (/^(DIRECT_URL$|SHADOW_DATABASE_URL$|SMARTSTORE_(OBJECT_STORAGE|EVIDENCE_STORAGE|VAPID|IMAGE_WORKER|DIRECT_IMAGE|IMAGE_INTAKE|RUN_DB_MIGRATIONS|RATE_LIMIT|PUSH|NATIVE_PUSH)|CLOUDFLARE_|UPSTASH_|FIREBASE_|APNS_|GOOGLE_|APPLE_|AWS_|S3_|R2_|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGOPTIONS|NODE_OPTIONS$)/.test(name)) delete clean[name];
  }
  return { ...clean, DATABASE_URL: plan.databaseUrl, DIRECT_URL: '', SHADOW_DATABASE_URL: '', CI: '1', NODE_ENV: 'test',
    DEEPSEEK_API_KEY: 'test-model-placeholder', AUTH_SECRET: 'isolated-ci-postgres-contract-tests-only',
    npm_lifecycle_event: 'test', SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_DB_INTEGRATION: '1',
    SMARTSTORE_OWNER_RESET_INTEGRATION: '1', SMARTSTORE_IMAGE_STORAGE: 'inline', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    SMARTSTORE_RUN_DB_MIGRATIONS_ON_START: '0', SMARTSTORE_CONTRACT_CONTEXT_HASH: plan.contextHash,
    TSX_TSCONFIG_PATH: join(root, 'tsconfig.json'),
    SMARTSTORE_DATA_DIR: mkdtempSync(join(tmpdir(), 'smartstore-ci-postgres-')) };
}

async function databasePreflight(databaseUrl) {
  const { PrismaClient } = await import('@prisma/client');
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  try {
    const [identity] = await database.$queryRaw`SELECT current_database() AS name,
      (SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user) AS can_create_database`;
    if (identity?.name !== databaseName || identity.can_create_database !== true) {
      throw new Error('The disposable PostgreSQL test role must connect to smartstore_codex_test and have CREATEDB for isolated reset fixtures.');
    }
  } catch {
    // Provider errors may contain credentials. Keep all connection diagnostics generic.
    throw new Error('The dedicated PostgreSQL test service is unavailable or its role lacks CREATEDB.');
  } finally { await database.$disconnect(); }
}

function runNode(root, args, env, logFile) {
  const log = openSync(logFile, 'w');
  return new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', log, log] });
    child.once('error', () => { closeSync(log); reject(new Error('Could not start the isolated PostgreSQL validation process.')); });
    child.once('exit', code => {
      closeSync(log);
      // Prisma diagnostics may contain connection strings on an unexpected failure.
      const output = readFileSync(logFile, 'utf8').replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[PostgreSQL connection redacted]');
      writeFileSync(logFile, output);
      resolveCode(code ?? 1);
    });
  });
}

export async function runCiPostgresContracts(root, options = {}) {
  const env = options.env ?? process.env;
  const plan = createCiPostgresPlan(root, { planPath: options.planPath, env });
  const childEnv = ciPostgresChildEnvironment(root, env, plan);
  const execute = options.execute ?? runNode;
  await (options.preflight ?? databasePreflight)(plan.databaseUrl);
  mkdirSync(join(root, 'coverage'), { recursive: true });
  const migrationCode = await execute(root, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], childEnv,
    join(root, 'coverage/mobile-contracts-postgres-migrations.log'));
  if (migrationCode !== 0) throw new Error('Committed migrations failed on the disposable PostgreSQL test service; inspect the CI migration log.');
  const preload = pathToFileURL(join(root, 'scripts/testing/isolated-model-provider.mjs')).href;
  const testCode = await execute(root, ['--import', preload, 'node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1',
    '--test-reporter=spec', '--test-reporter-destination=coverage/mobile-contracts-postgres.log',
    '--test-reporter=./scripts/testing/mobile-test-reporter.mjs', '--test-reporter-destination=coverage/mobile-contract-results-postgres.json',
    ...plan.files], childEnv, join(root, 'coverage/mobile-contracts-postgres-process.log'));
  if (testCode !== 0) throw new Error('PostgreSQL contract tests failed; inspect coverage/mobile-contracts-postgres.log.');
  const receipt = JSON.parse(readFileSync(join(root, 'coverage/mobile-contract-results-postgres.json'), 'utf8'));
  if (receipt.contextHash !== plan.contextHash || !Array.isArray(receipt.tests) ||
    !(receipt.summary?.passed > 0) || receipt.summary.failed !== 0 || receipt.summary.skipped !== 0 || receipt.summary.todo !== 0 ||
    plan.files.some(file => !receipt.tests.some(test => test.file === file && test.status === 'passed'))) {
    throw new Error('PostgreSQL contract receipts must show every discovered integration file passed without skipped or failed tests.');
  }
  return { files: plan.files.length, contextHash: plan.contextHash };
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--plan' || !args[1])) {
    console.error('Usage: node scripts/testing/run-ci-postgres-contracts.mjs [--plan <checkout-local-plan.json>]');
    process.exitCode = 1;
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    runCiPostgresContracts(root, { planPath: args[1] }).then(result => {
      console.log(`PostgreSQL contracts passed: ${result.files} integration test files on the dedicated disposable service.`);
    }).catch(error => { console.error(error instanceof Error ? error.message : 'PostgreSQL contract validation failed.'); process.exitCode = 1; });
  }
}
