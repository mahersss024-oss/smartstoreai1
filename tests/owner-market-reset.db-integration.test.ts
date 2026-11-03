import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { executeMarketReset, getMarketResetPreview, marketResetConfirmation } from '@/lib/admin/market-reset';

// The retired reset no longer needs a destructive database fixture. The opt-in
// regression reads only the dedicated disposable database and proves every row
// survives attempts to call the former programmatic capability.
test('retired owner market reset leaves every local PostgreSQL table unchanged', {
  skip: process.env.SMARTSTORE_OWNER_RESET_INTEGRATION !== '1', timeout: 30_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test'); assert.equal(url.hash, '');
  assert.ok([...url.searchParams].every(([key, value]) => key === 'schema' && value === 'public'));
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try {
    const snapshot = () => database.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      const result: Array<{ table: string; count: bigint; fingerprint: string }> = [];
      for (const model of Prisma.dmmf.datamodel.models) {
        const table = model.dbName ?? model.name;
        const [row] = await tx.$queryRaw<Array<{ count: bigint; fingerprint: string }>>(Prisma.sql`
          SELECT count(*)::bigint AS count,
            md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS fingerprint
          FROM ${Prisma.raw(`"${table.replaceAll('"', '""')}"`)} t`);
        result.push({ table, ...row });
      }
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 3000, timeout: 25_000 });
    const before = await snapshot();
    await assert.rejects(getMarketResetPreview('configured-owner'), { code: 'maintenance_read_only', status: 403 });
    await assert.rejects(executeMarketReset({ actorId: 'configured-owner', reason: 'Retired capability regression',
      previewToken: 'legacy-preview-token', confirmation: marketResetConfirmation,
      backupConfirmed: true, includeProtectedData: true }), { code: 'maintenance_read_only', status: 403 });
    // A new transaction observes committed writes from any accidentally invoked
    // connection; reusing the previous snapshot would hide those changes.
    assert.deepEqual(await snapshot(), before);
  } finally { await database.$disconnect(); }
});
