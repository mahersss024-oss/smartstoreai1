import { createHash, X509Certificate } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { compareDatabaseSchema, type CatalogColumn, type CatalogEnum, type CatalogForeignKey, type CatalogIndex } from '@/lib/admin/database-schema-contract';
import { getActiveMigrationTriggers } from '@/lib/admin/database-compatibility-utils';
import { getOwnedRecoveryTarget } from './rds';
import { RecoveryError, type RecoveryOptions, type RecoveryTargetIdentity, type RestoredDatabaseReport } from './types';

type DatabaseReader = Pick<PrismaClient, '$transaction' | '$disconnect'>;
export type RestoredDatabaseOptions = RecoveryOptions & { root?: string;
  targetResolver?: typeof getOwnedRecoveryTarget; createClient?: (url: string) => DatabaseReader };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function recoveryFunctionBodies(sqlFiles: readonly string[]) {
  const bodies = new Map<string, string>();
  for (const sql of sqlFiles) for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z_][\w$]*)"?\s*\([^;]*?\)[\s\S]*?\bAS\s+\$([a-zA-Z_0-9]*)\$([\s\S]*?)\$\2\$/gi)) {
    bodies.set(match[1], match[3].replaceAll('\r\n', '\n').trim());
  }
  return bodies;
}

/** Prisma 5's strict CA+hostname verification is equivalent to libpq verify-full. */
export function restoredDatabaseUrl(sourceUrl: string, target: RecoveryTargetIdentity, caFile: string) {
  try {
    const source = new URL(sourceUrl);
    if (!['postgresql:', 'postgres:'].includes(source.protocol) || source.hostname !== target.sourceEndpoint ||
      (source.port && source.port !== '5432') || !source.username || !source.pathname || source.pathname === '/' ||
      source.hash || !isAbsolute(caFile) || !/^souqhamad-recovery-[a-f0-9]{20}$/.test(target.targetId) ||
      target.targetResourceId === target.sourceResourceId || target.targetArn === target.sourceArn ||
      target.endpoint === target.sourceEndpoint || target.port !== 5432 ||
      !/^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(target.endpoint)) throw new Error();
    source.protocol = 'postgresql:'; source.hostname = target.endpoint; source.port = '5432'; source.search = '';
    source.searchParams.set('schema', 'public'); source.searchParams.set('connection_limit', '1');
    source.searchParams.set('connect_timeout', '5'); source.searchParams.set('pool_timeout', '5');
    source.searchParams.set('socket_timeout', '8'); source.searchParams.set('sslmode', 'require');
    source.searchParams.set('sslaccept', 'strict'); source.searchParams.set('sslcert', caFile);
    return source.toString();
  } catch { throw new RecoveryError('recovery_database_configuration_invalid', 503); }
}

async function migrations(root: string) {
  const directory = join(root, 'prisma/migrations');
  const names = (await readdir(directory, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
  const files = await Promise.all(names.map(async name => ({ name, sql: await readFile(join(directory, name, 'migration.sql'), 'utf8') })));
  if (!files.length) throw new RecoveryError('recovery_schema_unavailable', 503);
  return files.map(file => ({ ...file, checksum: digest(file.sql) }));
}

async function checkCa(caFile: string, now: number) {
  if (!isAbsolute(caFile)) throw new RecoveryError('recovery_ca_unavailable', 503);
  try {
    if ((await stat(caFile)).size > 2_000_000) throw new Error();
    const pem = await readFile(caFile, 'utf8');
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    if (!certificates.some(value => {
      const certificate = new X509Certificate(value);
      return certificate.ca && Date.parse(certificate.validFrom) <= now && Date.parse(certificate.validTo) > now;
    })) throw new Error();
  } catch { throw new RecoveryError('recovery_ca_unavailable', 503); }
}

async function readReport(tx: Prisma.TransactionClient, root: string, target: RecoveryTargetIdentity, url: string, now: number): Promise<RestoredDatabaseReport> {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
  await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
  const [identity] = await tx.$queryRaw<Array<{ database: string; read_only: string; ssl: boolean; version: string }>>`
    SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only,
      coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS ssl,
      current_setting('server_version') AS version`;
  if (!identity || identity.database !== decodeURIComponent(new URL(url).pathname.slice(1)) || identity.read_only !== 'on' || identity.ssl !== true ||
    !identity.version.startsWith(target.engineVersion)) throw new RecoveryError('recovery_database_identity_mismatch', 409);
  const files = await migrations(root);
  const schemaText = await readFile(join(root, 'prisma/schema.prisma'), 'utf8');
  const models = Prisma.dmmf.datamodel.models;
  const tables = await tx.$queryRaw<Array<{ name: string }>>`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`;
  const presentTables = new Set(tables.map(row => row.name));
  const applied = presentTables.has('_prisma_migrations')
    ? await tx.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name`
    : [];
  const completed = applied.filter(row => row.finished_at && !row.rolled_back_at);
  const migrationReport = { expected: files.length, applied: completed.length,
    pending: files.filter(file => !completed.some(row => row.migration_name === file.name)).map(file => file.name),
    unknown: completed.filter(row => !files.some(file => file.name === row.migration_name)).map(row => row.migration_name),
    failed: applied.filter(row => !row.finished_at && !row.rolled_back_at).map(row => row.migration_name),
    checksumMismatch: completed.filter(row => files.some(file => file.name === row.migration_name && file.checksum !== row.checksum)).map(row => row.migration_name) };
  const columns = await tx.$queryRaw<CatalogColumn[]>`SELECT table_name,column_name,data_type,udt_name,is_nullable,
    character_maximum_length,numeric_precision,numeric_scale,datetime_precision FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
  const indexes = await tx.$queryRaw<CatalogIndex[]>`SELECT c.relname AS table_name,i.indisprimary AS is_primary,
    i.indisunique AS is_unique,(i.indisvalid AND i.indisready) AS is_valid,i.indpred IS NOT NULL AS is_partial,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,position)
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE k.position<=i.indnkeyatts ORDER BY k.position) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace AND (i.indisprimary OR i.indisunique)`;
  const foreignKeys = await tx.$queryRaw<CatalogForeignKey[]>`SELECT c.relname AS table_name,r.relname AS referenced_table,
    f.confdeltype::text AS delete_action,f.confupdtype::text AS update_action,f.convalidated AS validated,
    ARRAY(SELECT a.attname::text FROM unnest(f.conkey) WITH ORDINALITY AS k(attnum,position)
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.position) AS columns,
    ARRAY(SELECT a.attname::text FROM unnest(f.confkey) WITH ORDINALITY AS k(attnum,position)
      JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=k.attnum ORDER BY k.position) AS referenced_columns
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_class r ON r.oid=f.confrelid
    WHERE c.relnamespace='public'::regnamespace AND r.relnamespace='public'::regnamespace AND f.contype='f'`;
  const enums = await tx.$queryRaw<CatalogEnum[]>`SELECT t.typname AS name,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace GROUP BY t.typname`;
  const functions = await tx.$queryRaw<Array<{ name: string; definition: string }>>`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') ORDER BY p.proname`;
  const triggers = await tx.$queryRaw<Array<{ name: string; table_name: string; enabled: string; definition: string }>>`
    SELECT t.tgname AS name,c.relname AS table_name,t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
  const contract = compareDatabaseSchema(models, Prisma.dmmf.datamodel.enums, schemaText, { columns, indexes, foreignKeys, enums });
  const issues = Object.values(contract).flat();
  const expectedTables = new Set(models.map(model => model.dbName ?? model.name));
  for (const name of expectedTables) if (!presentTables.has(name)) issues.push(`missing_table:${name}`);
  for (const table of tables) if (!expectedTables.has(table.name) && table.name !== '_prisma_migrations') issues.push(`extra_table:${table.name}`);
  for (const model of models) {
    const table = model.dbName ?? model.name;
    for (const field of model.fields.filter(field => field.kind === 'scalar' || field.kind === 'enum')) {
      if (!columns.some(column => column.table_name === table && column.column_name === (field.dbName ?? field.name))) issues.push(`missing_column:${table}.${field.name}`);
    }
  }
  const expectedTriggers = getActiveMigrationTriggers(files.map(file => file.sql));
  for (const name of expectedTriggers) {
    const trigger = triggers.find(item => `${item.table_name}.${item.name}` === name);
    if (!trigger) issues.push(`missing_trigger:${name}`);
    else if (!['O', 'A'].includes(trigger.enabled)) issues.push(`disabled_trigger:${name}`);
  }
  const expectedFunctions = recoveryFunctionBodies(files.map(file => file.sql));
  for (const [name, body] of expectedFunctions) {
    const current = functions.find(item => item.name === name);
    if (!current) issues.push(`missing_function:${name}`);
    else if (recoveryFunctionBodies([current.definition]).get(name) !== body) issues.push(`changed_function:${name}`);
  }
  const counts: RestoredDatabaseReport['counts'] = [];
  for (const model of models) {
    const table = model.dbName ?? model.name;
    if (!presentTables.has(table)) continue;
    const [count] = await tx.$queryRawUnsafe<Array<{ rows: bigint }>>(`SELECT count(*)::bigint AS rows FROM public.${quoted(table)}`);
    counts.push({ table, rows: Number(count.rows) });
  }
  const orphanMetrics: RestoredDatabaseReport['foreignKeys'] = [];
  // Identifiers come only from the checked-in Prisma model, never the browser
  // or arbitrary restored SQL. Aggregate counts never return customer values.
  for (const model of models) for (const relation of model.fields.filter(field => field.kind === 'object' && field.relationFromFields?.length)) {
    const related = models.find(item => item.name === relation.type);
    if (!related) continue;
    const left = model.dbName ?? model.name; const right = related.dbName ?? related.name;
    const from = relation.relationFromFields!.map(name => model.fields.find(field => field.name === name)!);
    const to = (relation.relationToFields ?? []).map(name => related.fields.find(field => field.name === name)!);
    if (!presentTables.has(left) || !presentTables.has(right) || from.length !== to.length ||
      [...from.map(field => [left, field.dbName ?? field.name]), ...to.map(field => [right, field.dbName ?? field.name])]
        .some(([table, name]) => !columns.some(column => column.table_name === table && column.column_name === name))) continue;
    const required = from.map(field => `c.${quoted(field.dbName ?? field.name)} IS NOT NULL`).join(' AND ');
    const match = from.map((field, index) => `p.${quoted(to[index].dbName ?? to[index].name)}=c.${quoted(field.dbName ?? field.name)}`).join(' AND ');
    const [count] = await tx.$queryRawUnsafe<Array<{ rows: bigint }>>(`SELECT count(*)::bigint AS rows FROM public.${quoted(left)} c
      WHERE ${required} AND NOT EXISTS (SELECT 1 FROM public.${quoted(right)} p WHERE ${match})`);
    orphanMetrics.push({ relation: `${left}(${from.map(field => field.name).join(',')})->${right}`, orphanRows: Number(count.rows) });
  }
  const jobs: RestoredDatabaseReport['jobs'] = [];
  const jobsSql = [
    ['ListingImageUpload', `SELECT count(*) FILTER(WHERE status IN ('pending','processing'))::bigint AS pending,
      count(*) FILTER(WHERE status='failed')::bigint AS failed,count(*) FILTER(WHERE status='processing' AND "leaseUntil"<CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::bigint AS expired FROM "ListingImageUpload"`],
    ['ImageObjectCleanup', `SELECT count(*) FILTER(WHERE "cleanupAt" IS NULL)::bigint AS pending,
      count(*) FILTER(WHERE "cleanupAt" IS NULL AND attempts>0)::bigint AS failed,count(*) FILTER(WHERE "cleanupAt" IS NULL AND "leaseUntil"<CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::bigint AS expired FROM "ImageObjectCleanup"`],
    ['EvidenceAsset', `SELECT count(*) FILTER(WHERE status IN ('pending','copying'))::bigint AS pending,
      count(*) FILTER(WHERE status='failed')::bigint AS failed,count(*) FILTER(WHERE status='copying' AND "leaseUntil"<CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::bigint AS expired FROM "EvidenceAsset"`],
    ['NotificationDeliveryJob', `SELECT count(*) FILTER(WHERE "completedAt" IS NULL AND "failedAt" IS NULL)::bigint AS pending,
      count(*) FILTER(WHERE "failedAt" IS NOT NULL)::bigint AS failed,count(*) FILTER(WHERE "completedAt" IS NULL AND "failedAt" IS NULL AND "leaseUntil"<CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::bigint AS expired FROM "NotificationDeliveryJob"`],
  ];
  if (!issues.length) for (const [kind, sql] of jobsSql) {
    const [row] = await tx.$queryRawUnsafe<Array<{ pending: bigint; failed: bigint; expired: bigint }>>(sql);
    jobs.push({ kind, pending: Number(row.pending), failed: Number(row.failed), expiredLease: Number(row.expired) });
  }
  const attention = issues.length || Object.entries(migrationReport).some(([key, value]) => !['expected', 'applied'].includes(key) && Array.isArray(value) && value.length) ||
    orphanMetrics.some(item => item.orphanRows > 0) || jobs.some(job => job.failed > 0 || job.expiredLease > 0);
  return { operationId: target.operationId, targetId: target.targetId, checkedAt: new Date(now).toISOString(), status: attention ? 'attention' : 'passed',
    tlsVerified: true, readOnly: true, engineVersion: target.engineVersion, migrations: migrationReport,
    schema: { tablesChecked: models.length, issues, fingerprint: digest(JSON.stringify({ columns, indexes, foreignKeys, enums, functions, triggers })) },
    counts, foreignKeys: orphanMetrics, jobs, workersStarted: false, customerRowsReturned: false };
}

export async function verifyRestoredDatabase(actorId: string, input: { targetId: string }, options: RestoredDatabaseOptions = {}): Promise<RestoredDatabaseReport> {
  let database: DatabaseReader | undefined;
  try {
    const env = options.env ?? process.env; const now = options.now ?? Date.now();
    const target = await (options.targetResolver ?? getOwnedRecoveryTarget)(actorId, input.targetId, options);
    const caFile = env.SMARTSTORE_RECOVERY_CA_BUNDLE_FILE?.trim();
    if (!caFile) throw new RecoveryError('recovery_ca_unavailable', 503);
    const url = restoredDatabaseUrl(env.DATABASE_URL ?? '', target, caFile);
    await checkCa(caFile, now);
    database = options.createClient ? options.createClient(url) : new PrismaClient({ datasources: { db: { url } }, log: [] });
    return await database.$transaction(tx => readReport(tx, options.root ?? process.cwd(), target, url, now),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 3000, timeout: 60_000 });
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError('recovery_database_verification_unavailable', 503);
  } finally { if (database) await database.$disconnect().catch(() => {}); }
}
