import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getActiveMigrationTriggers, isPrismaTableType } from '@/lib/admin/database-compatibility-utils';

const projectRoot = process.cwd();

test('schema compatibility counts base tables and ignores extension views', () => {
  assert.equal(isPrismaTableType('BASE TABLE'), true);
  assert.equal(isPrismaTableType('VIEW'), false);
  assert.equal(isPrismaTableType('FOREIGN'), false);
});

test('migration inventory excludes evidence backfill triggers dropped by their migration', () => {
  const migration = readFileSync(
    join(projectRoot, 'prisma/migrations/20261016020000_customer_evidence/migration.sql'),
    'utf8',
  );
  const triggers = getActiveMigrationTriggers([migration]);

  assert.equal(triggers.has('Report.evidence_backfill'), false);
  assert.equal(triggers.has('UserReport.evidence_backfill'), false);
  assert.equal(triggers.has('ListingImage.evidence_insert'), true);
  assert.equal(triggers.has('EvidenceCase.evidence_immutable'), true);
});

test('migration trigger tracking applies create and drop operations in file order', () => {
  const triggers = getActiveMigrationTriggers([
    'CREATE TRIGGER "temporary" AFTER UPDATE ON "Report" FOR EACH ROW EXECUTE FUNCTION f(); DROP TRIGGER "temporary" ON "Report"; CREATE TRIGGER "temporary" AFTER UPDATE ON "UserReport" FOR EACH ROW EXECUTE FUNCTION f();',
  ]);

  assert.deepEqual([...triggers], ['UserReport.temporary']);
});
