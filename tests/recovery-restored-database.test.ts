import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import test, { type TestContext } from 'node:test';
import { Prisma } from '@prisma/client';
import { recoveryFunctionBodies, restoredDatabaseUrl, verifyRestoredDatabase, type RestoredDatabaseOptions } from '@/lib/recovery/restored-database';
import { type RecoveryTargetIdentity } from '@/lib/recovery/types';

const now = Date.parse('2026-11-03T12:00:00.000Z');
const token = 'a'.repeat(20);
const target: RecoveryTargetIdentity = { operationId: token, targetId: `souqhamad-recovery-${token}`,
  targetArn: `arn:aws:rds:eu-central-1:102913100808:db:souqhamad-recovery-${token}`, targetResourceId: 'db-TARGET',
  sourceArn: 'arn:aws:rds:eu-central-1:102913100808:db:smartstore-db', sourceResourceId: 'db-SOURCE',
  sourceEndpoint: 'smartstore-db.synthetic.eu-central-1.rds.amazonaws.com',
  endpoint: `souqhamad-recovery-${token}.synthetic.eu-central-1.rds.amazonaws.com`, port: 5432, engineVersion: '17.11',
  status: 'available', selection: { mode: 'snapshot', snapshotId: 'synthetic-backup' }, instance: {} };
const sourceUrl = `postgresql://synthetic:private-fixture-password@${target.sourceEndpoint}:5432/sm?host=production-override&sslaccept=accept_invalid_certs&sslmode=disable`;

function fixture(t: TestContext, faults: { ssl?: boolean; readOnly?: string; checksum?: string; orphans?: number; body?: string; throwQuery?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'recovery-reader-fixture-'));
  t.after(() => { assert.ok(root.startsWith(join(tmpdir(), 'recovery-reader-fixture-'))); rmSync(root, { recursive: true, force: true }); });
  const ca = join(root, 'public-test-ca.pem');
  const pem = rootCertificates.find(value => { const certificate = new X509Certificate(value);
    return certificate.ca && Date.parse(certificate.validFrom) <= now && Date.parse(certificate.validTo) > now; });
  assert.ok(pem); writeFileSync(ca, pem);
  const migrationName = '20260101000000_synthetic_recovery';
  const migrationSql = 'CREATE FUNCTION recovery_probe() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;';
  const migration = join(root, 'prisma/migrations', migrationName); mkdirSync(migration, { recursive: true });
  writeFileSync(join(migration, 'migration.sql'), migrationSql);
  const schema = readFileSync('prisma/schema.prisma', 'utf8'); writeFileSync(join(root, 'prisma/schema.prisma'), schema);
  const models = Prisma.dmmf.datamodel.models;
  const defaults: Record<string, string> = { String: 'text', Int: 'int4', BigInt: 'int8', Float: 'float8', Decimal: 'numeric', Boolean: 'bool', DateTime: 'timestamp', Json: 'jsonb', Bytes: 'bytea' };
  const nativeNames: Record<string, string> = { Text: 'text', VarChar: 'varchar', Char: 'bpchar', Decimal: 'numeric' };
  const columns = models.flatMap(model => {
    const block = schema.match(new RegExp(`^model ${model.name} \\{([\\s\\S]*?)^\\}`, 'm'))?.[1] ?? '';
    return model.fields.filter(field => field.kind !== 'object').map(field => {
      const declaration = block.match(new RegExp(`^\\s*${field.name}\\s+.*$`, 'm'))?.[0] ?? '';
      const native = declaration.match(/@db\.(\w+)(?:\(([^)]*)\))?/);
      const args = native?.[2]?.split(',').map(Number) ?? [];
      const type = field.kind === 'enum' ? field.type : native ? nativeNames[native[1]] : defaults[field.type];
      return { table_name: model.name, column_name: field.name, udt_name: `${field.isList ? '_' : ''}${type}`, is_nullable: field.isRequired ? 'NO' : 'YES',
        character_maximum_length: ['VarChar', 'Char'].includes(native?.[1] ?? '') ? args[0] : null,
        numeric_precision: native?.[1] === 'Decimal' ? args[0] : null, numeric_scale: native?.[1] === 'Decimal' ? args[1] : null,
        datetime_precision: field.type === 'DateTime' ? 3 : null };
    });
  });
  const indexes = models.flatMap(model => [{ fields: model.primaryKey?.fields ?? model.fields.filter(field => field.isId).map(field => field.name), primary: true },
    ...model.uniqueFields.map(fields => ({ fields, primary: false })), ...model.fields.filter(field => field.isUnique).map(field => ({ fields: [field.name], primary: false }))]
    .filter(key => key.fields.length).map(key => ({ table_name: model.name, columns: key.fields, is_primary: key.primary, is_unique: true, is_valid: true, is_partial: false })));
  const action: Record<string, string> = { Cascade: 'c', Restrict: 'r', SetNull: 'n', NoAction: 'a' };
  const foreignKeys = models.flatMap(model => model.fields.filter(field => field.kind === 'object' && field.relationFromFields?.length).map(field => ({
    table_name: model.name, referenced_table: field.type, columns: field.relationFromFields, referenced_columns: field.relationToFields,
    delete_action: action[field.relationOnDelete ?? (field.isRequired ? 'Restrict' : 'SetNull')], update_action: 'c', validated: true })));
  const statements: string[] = []; let disconnected = false; let createdUrl = '';
  function queryText(value: unknown) { return Array.isArray(value) ? value.join('?') : String(value); }
  const tx = {
    $executeRaw: async (value: unknown) => { const sql = queryText(value); statements.push(sql); assert.match(sql, /^SET /); return 0; },
    $queryRaw: async (value: unknown) => {
      const sql = queryText(value); statements.push(sql);
      if (faults.throwQuery) throw new Error('private-fixture-password customer-email@example.test unsafe-provider-log');
      if (sql.includes('current_database()')) return [{ database: 'sm', read_only: faults.readOnly ?? 'on', ssl: faults.ssl ?? true, version: '17.11' }];
      if (sql.includes("c.relkind IN ('r','p')")) return [...models.map(model => ({ name: model.name })), { name: '_prisma_migrations' }];
      if (sql.includes('FROM public._prisma_migrations')) return [{ migration_name: migrationName, checksum: faults.checksum ?? createHash('sha256').update(migrationSql).digest('hex'), finished_at: new Date(now), rolled_back_at: null }];
      if (sql.includes('information_schema.columns')) return columns;
      if (sql.includes('FROM pg_index')) return indexes;
      if (sql.includes('FROM pg_constraint')) return foreignKeys;
      if (sql.includes('FROM pg_type')) return Prisma.dmmf.datamodel.enums.map(value => ({ name: value.name, values: value.values.map(item => item.name) }));
      if (sql.includes('FROM pg_proc')) return [{ name: 'recovery_probe', definition: faults.body ?? migrationSql }];
      if (sql.includes('FROM pg_trigger')) return [];
      throw new Error('Unexpected fixed catalog query');
    },
    $queryRawUnsafe: async (sql: string) => { statements.push(sql); assert.match(sql, /^SELECT /);
      if (sql.includes('FILTER(')) return [{ pending: BigInt(2), failed: BigInt(0), expired: BigInt(0) }];
      return [{ rows: BigInt(sql.includes('NOT EXISTS') ? faults.orphans ?? 0 : 1) }]; },
  };
  const createClient: RestoredDatabaseOptions['createClient'] = url => { createdUrl = url; return {
    $transaction: async (work: (transaction: unknown) => unknown, options: Record<string, unknown>) => {
      assert.equal(options.isolationLevel, 'RepeatableRead'); return work(tx);
    }, $disconnect: async () => { disconnected = true; },
  } as unknown as ReturnType<NonNullable<RestoredDatabaseOptions['createClient']>>; };
  const options: RestoredDatabaseOptions = { env: { DATABASE_URL: sourceUrl, SMARTSTORE_RECOVERY_CA_BUNDLE_FILE: ca }, now, root,
    targetResolver: async () => target, createClient };
  return { root, ca, statements, options, disconnected: () => disconnected, createdUrl: () => createdUrl };
}

test('restored connection strips inherited routing and requires a distinct attested endpoint with strict TLS', () => {
  const ca = join(tmpdir(), 'synthetic-ca.pem');
  const url = new URL(restoredDatabaseUrl(sourceUrl, target, ca));
  assert.equal(url.hostname, target.endpoint); assert.equal(url.pathname, '/sm');
  assert.equal(url.searchParams.get('host'), null); assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('sslaccept'), 'strict'); assert.equal(url.searchParams.get('sslcert'), ca);
  for (const unsafe of [{ ...target, endpoint: target.sourceEndpoint }, { ...target, targetResourceId: target.sourceResourceId },
    { ...target, targetArn: target.sourceArn }, { ...target, endpoint: '127.0.0.1' }, { ...target, port: 55432 }]) {
    assert.throws(() => restoredDatabaseUrl(sourceUrl, unsafe, ca), /recovery_database_configuration_invalid/);
  }
  assert.throws(() => restoredDatabaseUrl('postgresql://synthetic:private@foreign.invalid/sm', target, ca));
});

test('restored verification reports only aggregates with read-only SQL, migration checksums and recovery job counts', async t => {
  const runtime = fixture(t);
  const report = await verifyRestoredDatabase('owner', { targetId: target.targetId }, runtime.options);
  assert.equal(report.status, 'passed'); assert.equal(report.tlsVerified, true); assert.equal(report.readOnly, true);
  assert.equal(report.migrations.expected, 1); assert.deepEqual(report.migrations.checksumMismatch, []);
  assert.equal(report.counts.length, Prisma.dmmf.datamodel.models.length); assert.ok(report.foreignKeys.length > 20);
  assert.equal(report.jobs.length, 4); assert.ok(report.jobs.every(job => job.pending === 2));
  assert.equal(report.workersStarted, false); assert.equal(report.customerRowsReturned, false);
  assert.equal(runtime.disconnected(), true);
  assert.equal(runtime.statements[0], 'SET TRANSACTION READ ONLY');
  assert.ok(runtime.statements.every(statement => /^(SET |SELECT )/.test(statement.trimStart())));
  assert.doesNotMatch(JSON.stringify(report), /private-fixture-password|customer-email|payload|unsafe-provider-log|postgresql:\/\//);
});

test('restored verification flags checksum, function-body and orphan differences without attempting repairs', async t => {
  for (const faults of [{ checksum: 'b'.repeat(64) }, { body: 'CREATE FUNCTION recovery_probe() RETURNS void AS $$ BEGIN RAISE NOTICE \'changed\'; END $$ LANGUAGE plpgsql;' }, { orphans: 3 }]) {
    const runtime = fixture(t, faults);
    const report = await verifyRestoredDatabase('owner', { targetId: target.targetId }, runtime.options);
    assert.equal(report.status, 'attention');
    if ('checksum' in faults) assert.equal(report.migrations.checksumMismatch.length, 1);
    if ('body' in faults) assert.ok(report.schema.issues.includes('changed_function:recovery_probe'));
    if ('orphans' in faults) assert.ok(report.foreignKeys.some(relation => relation.orphanRows === 3));
    assert.ok(runtime.statements.every(statement => /^(SET |SELECT )/.test(statement.trimStart())));
  }
});

test('restored verification fails closed on TLS/read-only/identity errors and conceals provider details', async t => {
  for (const faults of [{ ssl: false }, { readOnly: 'off' }, { throwQuery: true }]) {
    const runtime = fixture(t, faults);
    await assert.rejects(verifyRestoredDatabase('owner', { targetId: target.targetId }, runtime.options), error => {
      assert.match((error as Error).message, /^recovery_database_(identity_mismatch|verification_unavailable)$/);
      assert.doesNotMatch((error as Error).message, /private-fixture-password|customer-email|provider-log/); return true;
    });
    assert.equal(runtime.disconnected(), true);
  }
  const runtime = fixture(t); let created = 0;
  await assert.rejects(verifyRestoredDatabase('owner', { targetId: target.targetId }, { ...runtime.options,
    env: { DATABASE_URL: sourceUrl }, createClient: () => { created++; throw new Error(); } }), /recovery_ca_unavailable/);
  assert.equal(created, 0);
});

test('recovery function comparison uses the final committed body and handles pg_get_functiondef dollar tags', () => {
  const before = 'CREATE FUNCTION guarded() RETURNS void AS $$ BEGIN RETURN; END $$ LANGUAGE plpgsql;';
  const after = 'CREATE OR REPLACE FUNCTION guarded() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'protected\'; END $$;';
  const actual = 'CREATE OR REPLACE FUNCTION public.guarded() RETURNS void LANGUAGE plpgsql AS $function$\n BEGIN RAISE EXCEPTION \'protected\'; END \n$function$;';
  assert.equal(recoveryFunctionBodies([before, after]).get('guarded'), recoveryFunctionBodies([actual]).get('guarded'));
});
