import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];
type DmmfField = DmmfModel['fields'][number];

const labels: Record<string, string> = {
  User: 'العملاء', Listing: 'الإعلانات', ListingImage: 'صور الإعلانات',
  ListingImageUpload: 'رفع الصور', ImageObjectCleanup: 'تنظيف ملفات الصور',
  Conversation: 'المحادثات', ConversationMessage: 'رسائل المحادثات',
  Favorite: 'المفضلة', SellerFollow: 'متابعة البائعين', SimilarListingFollow: 'متابعة الإعلانات المشابهة',
  SellerRating: 'تقييمات البائعين', UserBlock: 'حظر العملاء', Report: 'بلاغات الإعلانات',
  UserReport: 'بلاغات العملاء', EvidenceCase: 'قضايا الأدلة', EvidenceAsset: 'ملفات الأدلة',
  EvidenceEvent: 'سجل إجراءات الأدلة', Commission: 'العمولات', FollowNotification: 'إشعارات المتابعة',
  PushSubscription: 'اشتراكات إشعارات الويب', MobilePushToken: 'رموز إشعارات الجوال',
  NotificationDeliveryJob: 'مهام إرسال الإشعارات', MarketplaceSearchState: 'حالة البحث',
  ApiIdempotencyKey: 'مفاتيح منع تكرار الطلبات', SiteVisitDaily: 'زيارات الموقع اليومية',
  SiteVisitUnique: 'الزوار الفريدون', AdminAuditLog: 'سجل الإدارة', SiteMessage: 'رسائل الموقع',
};

const secretField = /(?:token|secret|password|authorization|endpoint|p256dh|lease|objectkey|sourceurl|rawresponse|fingerprint|snapshot|payload|metadata|privatekey|idempotencykey|ownerkey|^key$|(?:^|_)state$|url$|hash$)/i;
const secretJsonKey = /(?:token|secret|password|authorization|endpoint|p256dh|lease|object.?key|source.?url|raw.?response|fingerprint|snapshot|payload|metadata|private.?key|idempotency.?key|owner.?key|^key$|url$|hash$)/i;

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function modelTable(model: DmmfModel) {
  return model.dbName ?? model.name;
}

function dbField(field: DmmfField) {
  return field.dbName ?? field.name;
}

function scalarFields(model: DmmfModel) {
  return model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum');
}

function redact(value: unknown, key = ''): unknown {
  if (key && secretJsonKey.test(key)) return '[محجوب]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  return value;
}

function escapedLike(value: string) {
  return `%${value.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

function migrationObjectNames(contents: string, expression: RegExp) {
  return [...contents.matchAll(expression)].map((match) => match[1]).filter(Boolean);
}

async function migrationFiles() {
  const root = path.join(process.cwd(), 'prisma', 'migrations');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const sql = await Promise.all(names.map(async (name) => {
      try { return await readFile(path.join(root, name, 'migration.sql'), 'utf8'); }
      catch { return ''; }
    }));
    return { names, sql, available: true };
  } catch {
    return { names: [] as string[], sql: [] as string[], available: false };
  }
}

export async function getDatabaseOverview() {
  const models = Prisma.dmmf.datamodel.models;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
    const estimates = await tx.$queryRaw<Array<{ table_name: string; estimated_rows: bigint }>>`
      SELECT relname AS table_name, GREATEST(n_live_tup, 0)::bigint AS estimated_rows
      FROM pg_stat_user_tables
      WHERE schemaname = current_schema()
    `;
    const byTable = new Map(estimates.map((row) => [row.table_name, Number(row.estimated_rows)]));
    return {
      models: models.map((model) => ({
        name: model.name,
        table: modelTable(model),
        label: labels[model.name] ?? model.name,
        estimatedRows: byTable.get(modelTable(model)) ?? null,
        fields: scalarFields(model).map((field) => ({ name: dbField(field), type: field.type, redacted: secretField.test(dbField(field)) })),
      })),
      estimated: true,
    };
  }, { timeout: 10_000, maxWait: 3000 });
}

export async function getDatabaseTablePage(modelName: string, page: number, pageSize: number, search: string) {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  if (!model) return null;
  const table = quoteIdentifier(modelTable(model));
  const fields = scalarFields(model);
  const hidden = fields.filter((field) => secretField.test(dbField(field))).map(dbField);
  const hiddenSql = hidden.length
    ? Prisma.sql`ARRAY[${Prisma.join(hidden)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const sanitizedJson = Prisma.sql`(to_jsonb(t) - ${hiddenSql})`;
  const filter = search
    ? Prisma.sql`WHERE ${sanitizedJson}::text ILIKE ${escapedLike(search)} ESCAPE '!'`
    : Prisma.empty;
  const keys = model.primaryKey?.fields ?? fields.filter((field) => field.isId).map((field) => field.name);
  const orderFields = [
    ...fields.filter((field) => field.name === 'createdAt').map(dbField),
    ...keys.map((key) => dbField(fields.find((field) => field.name === key) ?? fields[0])),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  const orderBy = orderFields.length
    ? Prisma.raw(orderFields.map((field) => `${quoteIdentifier(field)} DESC`).join(', '))
    : Prisma.raw('1');
  const offset = (page - 1) * pageSize;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '6000ms'`;
    const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM ${Prisma.raw(table)} t ${filter}`,
    );
    const rows = await tx.$queryRaw<Array<{ data: Prisma.JsonValue }>>(
      Prisma.sql`SELECT ${sanitizedJson} AS data FROM ${Prisma.raw(table)} t ${filter} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
    );
    return {
      model: model.name,
      table: modelTable(model),
      label: labels[model.name] ?? model.name,
      columns: fields.map((field) => ({ name: dbField(field), type: field.type, redacted: secretField.test(dbField(field)) })),
      page,
      pageSize,
      total: Number(count.total),
      rows: rows.map((row) => redact(row.data)),
    };
  }, { timeout: 10_000, maxWait: 3000 });
}

export async function getDatabaseCompatibility() {
  const models = Prisma.dmmf.datamodel.models;
  const migrations = await migrationFiles();
  const expectedColumns = new Map(models.map((model) => [
    modelTable(model), scalarFields(model).map(dbField),
  ]));

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '7000ms'`;
    const actualColumns = await tx.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; udt_name: string }>>`
      SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position
    `;
    const actualTables = new Set(actualColumns.map((column) => column.table_name));
    const expectedTableNames = new Set(expectedColumns.keys());
    const actualByTable = new Map<string, Set<string>>();
    for (const column of actualColumns) {
      const set = actualByTable.get(column.table_name) ?? new Set<string>();
      set.add(column.column_name);
      actualByTable.set(column.table_name, set);
    }
    const tables = [...expectedColumns].map(([table, columns]) => ({
      table,
      missingTable: !actualTables.has(table),
      missingColumns: columns.filter((column) => !actualByTable.get(table)?.has(column)),
      extraColumns: [...(actualByTable.get(table) ?? [])].filter((column) => !columns.includes(column)),
    }));
    const migrationTableExists = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists
    `;
    let applied: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }> = [];
    if (migrationTableExists[0]?.exists) {
      applied = await tx.$queryRaw`
        SELECT migration_name, finished_at, rolled_back_at
        FROM public._prisma_migrations
        ORDER BY started_at
      `;
    }
    const appliedNames = new Set(applied.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
    const pendingMigrations = migrations.names.filter((name) => !appliedNames.has(name));
    const unknownAppliedMigrations = [...appliedNames].filter((name) => !migrations.names.includes(name));
    const failedMigrations = applied.filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
    const actualFunctions = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = current_schema() AND p.prokind IN ('f', 'p')
    `;
    const actualTriggers = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND NOT t.tgisinternal
    `;
    const actualExtensions = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT e.extname AS name FROM pg_extension e ORDER BY e.extname
    `;
    const expectedFunctions = new Set<string>();
    const expectedTriggers = new Set<string>();
    const expectedExtensions = new Set<string>();
    for (const sql of migrations.sql) {
      migrationObjectNames(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z_][\w$]*)"?/gi).forEach((name) => expectedFunctions.add(name));
      migrationObjectNames(sql, /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-zA-Z_][\w$]*)"?/gi).forEach((name) => expectedTriggers.add(name));
      migrationObjectNames(sql, /CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][\w$]*)"?/gi).forEach((name) => expectedExtensions.add(name));
    }
    const presentFunctions = new Set(actualFunctions.map((row) => row.name));
    const presentTriggers = new Set(actualTriggers.map((row) => row.name));
    const presentExtensions = new Set(actualExtensions.map((row) => row.name));
    const missingFunctions = [...expectedFunctions].filter((name) => !presentFunctions.has(name));
    const missingTriggers = [...expectedTriggers].filter((name) => !presentTriggers.has(name));
    const missingExtensions = [...expectedExtensions].filter((name) => !presentExtensions.has(name));
    return {
      checkedAt: new Date().toISOString(),
      migrations: {
        historyAvailable: Boolean(migrationTableExists[0]?.exists),
        filesAvailable: migrations.available,
        expected: migrations.names.length,
        applied: appliedNames.size,
        pending: pendingMigrations,
        failed: failedMigrations,
        unknownApplied: unknownAppliedMigrations,
      },
      schema: {
        tablesChecked: tables.length,
        missingTables: tables.filter((table) => table.missingTable).map((table) => table.table),
        missingColumns: tables.flatMap((table) => table.missingColumns.map((column) => `${table.table}.${column}`)),
        extraColumns: tables.flatMap((table) => table.extraColumns.map((column) => `${table.table}.${column}`)),
        extraTables: [...actualTables].filter((table) => table !== '_prisma_migrations' && !expectedTableNames.has(table)).sort(),
      },
      databaseObjects: {
        expectedFunctions: [...expectedFunctions].sort(),
        missingFunctions,
        expectedTriggers: [...expectedTriggers].sort(),
        missingTriggers,
        expectedExtensions: [...expectedExtensions].sort(),
        missingExtensions,
      },
    };
  }, { timeout: 12_000, maxWait: 3000 });
}
