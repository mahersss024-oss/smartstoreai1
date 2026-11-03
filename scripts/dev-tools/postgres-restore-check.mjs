import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tokenPattern = /^[a-f0-9]{24}$/;
const databasePattern = /^smartstore_restore_(source|target)_[a-f0-9]{24}$/;
const postgresBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const keptEnvironment = /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|PATHEXT|SYSTEMDRIVE)$/i;
const identitySql = `SELECT json_build_object('database',current_database(),'user',current_user,
  'directory',current_setting('data_directory'),'port',current_setting('port'),
  'listen',current_setting('listen_addresses'),'version',current_setting('server_version'),
  'versionNumber',current_setting('server_version_num')::integer,
  'createDatabase',(SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname=current_user));`;
const catalogSql = `SELECT jsonb_build_object(
  'tables',(SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'),
  'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position) FROM
    (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale
     FROM information_schema.columns WHERE table_schema='public') c),
  'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM
    (SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public') i),
  'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY relation,name) FROM
    (SELECT r.relname AS relation,c.conname AS name,pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE c.connamespace='public'::regnamespace) k),
  'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY name,definition) FROM
    (SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p')) f),
  'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relation,name) FROM
    (SELECT r.relname AS relation,g.tgname AS name,g.tgenabled AS enabled,pg_get_triggerdef(g.oid) AS definition
     FROM pg_trigger g JOIN pg_class r ON r.oid=g.tgrelid WHERE NOT g.tgisinternal AND r.relnamespace='public'::regnamespace) t),
  'enums',(SELECT jsonb_agg(to_jsonb(e) ORDER BY name,position) FROM
    (SELECT t.typname AS name,e.enumsortorder AS position,e.enumlabel AS label FROM pg_enum e
     JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace='public'::regnamespace) e));`;

export function validateRestoreOptIn(env) {
  if (env.SMARTSTORE_LOCAL_RESTORE_DRILL !== '1') {
    throw new Error('Set SMARTSTORE_LOCAL_RESTORE_DRILL=1 only for the isolated synthetic local restore drill.');
  }
}

export function validateRestoreSettings(settings) {
  if (settings?.host !== '127.0.0.1' || settings.port !== 55432 || settings.user !== 'codex_local' ||
    typeof settings.password !== 'string' || !settings.password.trim()) {
    throw new Error('Refusing settings outside the dedicated 127.0.0.1:55432 local cluster.');
  }
  return settings;
}

export function createRestorePlan(root, token = randomBytes(12).toString('hex')) {
  if (!tokenPattern.test(token)) throw new Error('Invalid internally generated restore drill identifier.');
  const state = resolve(root, '.data/codex-dev-postgres');
  return { token, state, cluster: join(state, 'data'), directory: join(state, 'restore-drills', token),
    source: `smartstore_restore_source_${token}`, target: `smartstore_restore_target_${token}`,
    receipt: resolve(root, 'coverage/postgres-restore-check.json') };
}

export function assertLocalRecoveryPath(path) {
  if (realpathSync(path) !== resolve(path)) throw new Error('Refusing a redirected local recovery directory.');
}

function readLocalSettings(state) {
  try { return JSON.parse(readFileSync(join(state, 'local.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('The private isolated PostgreSQL settings are unavailable or invalid; their contents were withheld.'); }
}

export function restoreChildEnvironment(env, settings, database = 'postgres') {
  validateRestoreSettings(settings);
  if (database !== 'postgres' && !databasePattern.test(database)) throw new Error('Refusing a persistent or foreign database name.');
  const clean = Object.fromEntries(Object.entries(env).filter(([name, value]) => keptEnvironment.test(name) && typeof value === 'string'));
  return { ...clean, NODE_ENV: 'test', CI: '1', PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'smartstore-synthetic-restore-drill', PGPASSWORD: settings.password,
    PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=2000', PGCLIENTENCODING: 'UTF8',
    PGPASSFILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
    PGSERVICEFILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
    DATABASE_URL: `postgresql://codex_local:${encodeURIComponent(settings.password)}@127.0.0.1:55432/${database}?schema=public`,
    DIRECT_URL: '', SHADOW_DATABASE_URL: '', SMARTSTORE_RUN_DB_MIGRATIONS_ON_START: '0',
    CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
}

export function executeRestoreTool(program, args, env, cwd, timeout = 60_000, phase = '') {
  return new Promise(resolveResult => {
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      // Windows pg_ctl can exit while its running server still holds inherited
      // pipe handles. Starting the server succeeds at process exit; waiting for
      // all pipe handles to close would wait until the database shuts down.
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      resolveResult({ code: code ?? 1, stdout, stderr });
    };
    const timer = setTimeout(() => { child.kill(); finish(1); }, timeout);
    child.stdout.on('data', chunk => { if (stdout.length < 2_000_000) stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < 2_000_000) stderr += chunk; });
    child.once('error', () => finish(1));
    child.once(phase === 'cluster-start' ? 'exit' : 'close', finish);
  });
}

function quote(value) { return `'${value.replaceAll("'", "''")}'`; }
function identifier(value) { return `"${value.replaceAll('"', '""')}"`; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function fixtureSql(token) {
  const q = name => quote(`restore_${name}_${token}`);
  return `BEGIN;
    INSERT INTO "User" (id,email,name,"updatedAt") VALUES
      (${q('seller')},'seller-${token}@example.test','Synthetic recovery seller',now()),
      (${q('buyer')},'buyer-${token}@example.test','Synthetic recovery buyer',now());
    INSERT INTO "Listing" (id,"sellerId",category,title,description,price,attributes,status,"updatedAt")
      VALUES (${q('listing')},${q('seller')},'furniture','أثاث اختبار الاسترجاع','Synthetic fixture only',125.50,'{"synthetic":true}','published',now());
    INSERT INTO "ListingImage" (id,"listingId","originalUrl","displayUrl","thumbnailUrl","qualityScore",status)
      VALUES (${q('image')},${q('listing')},'https://restore.example.invalid/display.webp',
        'https://restore.example.invalid/display.webp','https://restore.example.invalid/thumbnail.webp',100,'approved');
    INSERT INTO "Conversation" (id,"listingId","sellerId","buyerId","updatedAt")
      VALUES (${q('conversation')},${q('listing')},${q('seller')},${q('buyer')},now());
    INSERT INTO "ConversationMessage" (id,"conversationId","senderId",body)
      VALUES (${q('message')},${q('conversation')},${q('buyer')},'رسالة اختبار اصطناعية');
    INSERT INTO "Favorite" (id,"listingId","userId") VALUES (${q('favorite')},${q('listing')},${q('buyer')});
    INSERT INTO "Commission" (id,"listingId","sellerId","productValue","commissionAmount",status,"updatedAt")
      VALUES (${q('commission')},${q('listing')},${q('seller')},125.50,1.26,'due',now());
    INSERT INTO "Report" (id,"listingId","reporterId",reason,"updatedAt")
      VALUES (${q('report')},${q('listing')},${q('buyer')},'Synthetic recovery probe',now());
    COMMIT;`;
}

function dataSql(tables) {
  return `SELECT jsonb_build_object(${tables.map(table => `${quote(table)},(SELECT jsonb_build_object('rows',count(*),'sha256',
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex'))
    FROM public.${identifier(table)} t)`).join(',')});`;
}

function guardSql(token) {
  return `BEGIN; DO $$ BEGIN
    BEGIN
      INSERT INTO "Favorite" (id,"listingId","userId") VALUES ('restore-invalid-fk','does-not-exist','restore_buyer_${token}');
      RAISE EXCEPTION 'restore_foreign_key_missing';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      DELETE FROM "Listing" WHERE id='restore_listing_${token}';
      RAISE EXCEPTION 'restore_listing_guard_missing';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'evidence_protected' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE "EvidenceEvent" SET payload='{}'::jsonb;
      RAISE EXCEPTION 'restore_evidence_guard_missing';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'immutable_evidence_event' THEN RAISE; END IF;
    END;
    END $$; ROLLBACK;`;
}

function verifyData(data, migrations) {
  for (const [table, count] of Object.entries({ User: 2, Listing: 1, ListingImage: 1, Conversation: 1,
    ConversationMessage: 1, Favorite: 1, Commission: 1, Report: 1, EvidenceCase: 1, _prisma_migrations: migrations })) {
    if (data[table]?.rows !== count) throw new Error(`Synthetic restore fixture count did not match for ${table}.`);
  }
  if (!(data.EvidenceAsset?.rows >= 1) || !(data.EvidenceEvent?.rows >= 1)) throw new Error('Synthetic evidence capture was not preserved.');
}

export async function runRestoreCheck(root, options = {}) {
  const env = options.env ?? process.env;
  validateRestoreOptIn(env);
  const plan = createRestorePlan(root, options.token);
  if (options.settings !== undefined) validateRestoreSettings(options.settings);
  assertLocalRecoveryPath(plan.state);
  const settings = validateRestoreSettings(options.settings ?? readLocalSettings(plan.state));
  const bin = options.postgresBin ?? postgresBin;
  const execute = options.execute ?? executeRestoreTool;
  const tools = Object.fromEntries(['pg_ctl', 'psql', 'pg_dump', 'pg_restore'].map(name => [name, join(bin, `${name}.exe`)]));
  if (!existsSync(join(plan.cluster, 'PG_VERSION')) || Object.values(tools).some(file => !existsSync(file))) {
    throw new Error('The existing isolated PostgreSQL 17 cluster or its recovery tools were not found. Nothing was initialized.');
  }
  const cluster = realpathSync(plan.cluster);
  if (cluster !== resolve(plan.cluster)) throw new Error('Refusing a redirected local PostgreSQL cluster directory.');
  const migrations = readdirSync(join(root, 'prisma/migrations'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, 'prisma/migrations', entry.name, 'migration.sql'))).map(entry => entry.name).sort();
  if (!migrations.length) throw new Error('No committed migrations were found.');
  const childEnv = restoreChildEnvironment(env, settings);
  const checked = async (phase, program, args, child = childEnv) => {
    const result = await execute(program, args, child, root, 60_000, phase);
    if (result.code !== 0) throw new Error(`Local synthetic restore drill failed at ${phase}; raw tool diagnostics were withheld.`);
    return result.stdout.trim();
  };
  const sql = (phase, database, query) => {
    if (database !== 'postgres' && ![plan.source, plan.target].includes(database)) throw new Error('Refusing SQL against a persistent database.');
    // A UTF-8 input file avoids Windows command-line codepage conversion of
    // Arabic fixture text and keeps SQL out of process command lines.
    const input = join(plan.directory, `${phase}.sql`);
    writeFileSync(input, query, 'utf8');
    return checked(phase, tools.psql, ['-X', '-w', '-h', '127.0.0.1', '-p', '55432', '-U', 'codex_local',
      '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-f', input]);
  };
  const created = [];
  let initiallyRunning; let startAttempted = false; let failure;
  const began = Date.now();
  const receipt = { kind: 'synthetic-local-postgresql-restore', status: 'failed', startedAt: new Date().toISOString(),
    migrationCount: migrations.length, migrationContextHash: hash(migrations.map(name =>
      `${name}:${hash(readFileSync(join(root, 'prisma/migrations', name, 'migration.sql')))}`).join('\n')),
    productionAccess: false, existingApplicationRowsRead: false, dumpRetained: false,
    catalogMatches: false, allTableDataMatches: false, restoredGuardsPassed: false,
    temporaryDatabasesRemoved: false, clusterStateRestored: false };
  const parent = dirname(plan.directory);
  if (existsSync(parent)) assertLocalRecoveryPath(parent);
  else mkdirSync(parent);
  assertLocalRecoveryPath(parent);
  // Never reuse a pre-existing directory, including a redirected token path.
  mkdirSync(plan.directory);
  assertLocalRecoveryPath(plan.directory);
  try {
    const status = await execute(tools.pg_ctl, ['status', '-D', cluster], childEnv, root, 10_000, 'cluster-status');
    if (![0, 3].includes(status.code)) throw new Error('Could not determine the existing isolated cluster state.');
    initiallyRunning = status.code === 0;
    receipt.initiallyRunning = initiallyRunning;
    if (!initiallyRunning) {
      startAttempted = true;
      await checked('cluster-start', tools.pg_ctl, ['start', '-D', cluster, '-l', join(plan.directory, 'cluster.log'), '-w', '-t', '30']);
    }
    const identity = JSON.parse(await sql('cluster-identity', 'postgres', identitySql));
    if (identity.database !== 'postgres' || identity.user !== 'codex_local' || identity.port !== '55432' ||
      identity.listen !== '127.0.0.1' || resolve(identity.directory ?? '') !== cluster || identity.createDatabase !== true ||
      identity.versionNumber < 170000 || identity.versionNumber >= 180000) throw new Error('The server is not the expected isolated PostgreSQL 17 cluster.');
    receipt.serverVersion = identity.version;
    const toolsVersion = await checked('dump-version', tools.pg_dump, ['--version']);
    if (!/pg_dump .*\b17\./.test(toolsVersion)) throw new Error('The local dump tool must match PostgreSQL major version 17.');
    for (const database of [plan.source, plan.target]) {
      if (!databasePattern.test(database)) throw new Error('Refusing a non-disposable recovery database.');
      if (await sql('check-database-absent', 'postgres', `SELECT 1 FROM pg_database WHERE datname=${quote(database)};`)) {
        throw new Error('The random recovery database already exists and was left untouched.');
      }
      await sql(database === plan.source ? 'source-create' : 'target-create', 'postgres', `CREATE DATABASE ${identifier(database)} TEMPLATE template0;`);
      created.push(database);
      if (database === plan.source) {
        await checked('source-migrations', process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], restoreChildEnvironment(env, settings, database));
        await sql('source-fixtures', database, fixtureSql(plan.token));
        const catalog = JSON.parse(await sql('source-catalog', database, catalogSql));
        const data = JSON.parse(await sql('source-data', database, dataSql(catalog.tables)));
        verifyData(data, migrations.length);
        receipt.tableCount = catalog.tables.length;
        receipt.sourceCatalogHash = hash(JSON.stringify(catalog));
        receipt.sourceDataHash = hash(JSON.stringify(data));
        receipt.fixtureRows = Object.fromEntries(Object.entries(data).filter(([, value]) => value.rows > 0).map(([table, value]) => [table, value.rows]));
        await checked('source-dump', tools.pg_dump, ['-w', '-h', '127.0.0.1', '-p', '55432', '-U', 'codex_local',
          '--format=custom', '--no-owner', '--no-privileges', '--file', join(plan.directory, 'synthetic.dump'), database]);
        const dump = readFileSync(join(plan.directory, 'synthetic.dump'));
        if (dump.subarray(0, 5).toString('ascii') !== 'PGDMP') throw new Error('The synthetic backup is not a PostgreSQL custom archive.');
        receipt.dumpSha256 = hash(dump); receipt.dumpBytes = statSync(join(plan.directory, 'synthetic.dump')).size;
      }
    }
    const restoreBegan = Date.now();
    await checked('target-restore', tools.pg_restore, ['-w', '-h', '127.0.0.1', '-p', '55432', '-U', 'codex_local',
      '--dbname', plan.target, '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', join(plan.directory, 'synthetic.dump')]);
    receipt.restoreMilliseconds = Date.now() - restoreBegan;
    const targetCatalog = JSON.parse(await sql('target-catalog', plan.target, catalogSql));
    const targetData = JSON.parse(await sql('target-data', plan.target, dataSql(targetCatalog.tables)));
    verifyData(targetData, migrations.length);
    receipt.catalogMatches = hash(JSON.stringify(targetCatalog)) === receipt.sourceCatalogHash;
    receipt.allTableDataMatches = hash(JSON.stringify(targetData)) === receipt.sourceDataHash;
    if (!receipt.catalogMatches || !receipt.allTableDataMatches) throw new Error('Restored schema or full-table synthetic data fingerprint differs from the source.');
    await sql('target-guard-checks', plan.target, guardSql(plan.token));
    receipt.restoredGuardsPassed = true;
  } catch (error) { failure = error; }
  finally {
    for (const database of [...created].reverse()) {
      try {
        if (![plan.source, plan.target].includes(database) || !databasePattern.test(database)) throw new Error('Unsafe cleanup database.');
        await sql('cleanup-database', 'postgres', `DROP DATABASE ${identifier(database)} WITH (FORCE);`);
      } catch { failure ??= new Error('Temporary database cleanup failed; the local drill receipt requires attention.'); }
    }
    try {
      if (created.length) {
        const remaining = await sql('verify-cleanup', 'postgres', `SELECT count(*) FROM pg_database WHERE datname IN (${quote(plan.source)},${quote(plan.target)});`);
        receipt.temporaryDatabasesRemoved = remaining === '0';
      } else receipt.temporaryDatabasesRemoved = true;
      if (!receipt.temporaryDatabasesRemoved) throw new Error('Temporary recovery databases remain.');
    } catch { failure ??= new Error('Could not verify temporary database cleanup.'); }
    try {
      if (initiallyRunning === false && startAttempted) {
        const current = await execute(tools.pg_ctl, ['status', '-D', cluster], childEnv, root, 10_000, 'cluster-cleanup-status');
        if (current.code === 0) await checked('cluster-stop', tools.pg_ctl, ['stop', '-D', cluster, '-m', 'fast', '-w', '-t', '30']);
        else if (current.code !== 3) throw new Error('Could not determine the cluster cleanup state.');
      }
      if (typeof initiallyRunning === 'boolean') {
        const after = await execute(tools.pg_ctl, ['status', '-D', cluster], childEnv, root, 10_000, 'cluster-final-status');
        receipt.clusterStateRestored = after.code === (initiallyRunning ? 0 : 3);
      }
      if (!receipt.clusterStateRestored) throw new Error('Cluster state was not restored.');
    } catch { failure ??= new Error('Could not restore the original isolated cluster running state.'); }
    const within = relative(join(plan.state, 'restore-drills'), resolve(plan.directory));
    if (within !== plan.token || !tokenPattern.test(within)) throw new Error('Refusing filesystem cleanup outside the generated local recovery directory.');
    assertLocalRecoveryPath(plan.state); assertLocalRecoveryPath(parent); assertLocalRecoveryPath(plan.directory);
    rmSync(plan.directory, { recursive: true, force: true });
    receipt.status = failure ? 'failed' : 'passed'; receipt.durationMilliseconds = Date.now() - began;
    mkdirSync(dirname(plan.receipt), { recursive: true });
    writeFileSync(plan.receipt, JSON.stringify(receipt, null, 2) + '\n');
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) { console.error('Usage: node scripts/dev-tools/postgres-restore-check.mjs'); process.exitCode = 1; }
  else runRestoreCheck(resolve(dirname(fileURLToPath(import.meta.url)), '../..')).then(result => {
    console.log(`Synthetic PostgreSQL restore passed: ${result.migrationCount} migrations, ${result.tableCount} tables, exact schema/data match, restored guards passed; temporary databases removed and initial cluster state restored.`);
    console.log('Receipt: coverage/postgres-restore-check.json (no credentials or customer rows).');
  }).catch(error => { console.error(error instanceof Error ? error.message : 'Local PostgreSQL recovery drill failed.'); process.exitCode = 1; });
}
