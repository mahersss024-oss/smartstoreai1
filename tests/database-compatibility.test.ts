import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('literal FOREACH trigger declarations include every evidence lock and guard', () => {
  const migrations = readdirSync(join(projectRoot, 'prisma/migrations')).sort()
    .filter(name => /^\d/.test(name))
    .map(name => readFileSync(join(projectRoot, 'prisma/migrations', name, 'migration.sql'), 'utf8'));
  const triggers = getActiveMigrationTriggers(migrations);
  for (const table of ['Listing', 'ListingImage', 'Conversation', 'ConversationMessage', 'Commission', 'Report', 'UserReport']) {
    assert.ok(triggers.has(`${table}.evidence_00_lock`), `missing entity lock: ${table}`);
  }
  for (const table of ['User', 'Listing', 'ListingImage', 'Conversation', 'ConversationMessage', 'Commission', 'Report', 'UserReport']) {
    assert.ok(triggers.has(`${table}.evidence_guard`), `missing source guard: ${table}`);
  }
  assert.equal(triggers.size, 32);
});

test('dynamic literal trigger operations preserve later drops and migrations', () => {
  const triggers = getActiveMigrationTriggers([
    `DO $$ DECLARE target TEXT; BEGIN
       FOREACH target IN ARRAY ARRAY['User','Listing'] LOOP
         EXECUTE format('CREATE TRIGGER guard BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION f()', target);
       END LOOP;
       DROP TRIGGER guard ON "User";
     END $$;`,
    `DO $$ DECLARE target TEXT; BEGIN
       FOREACH target IN ARRAY ARRAY['Listing'] LOOP
         EXECUTE format('DROP TRIGGER guard ON %I', target);
       END LOOP;
       CREATE TRIGGER guard BEFORE UPDATE ON "Report" FOR EACH ROW EXECUTE FUNCTION f();
     END $$;`,
  ]);
  assert.deepEqual([...triggers], ['Report.guard']);
});

test('trigger inventory never evaluates arbitrary dynamic expressions', () => {
  const triggers = getActiveMigrationTriggers([
    `DO $$ DECLARE target TEXT; BEGIN
       FOREACH target IN ARRAY ARRAY['User' || current_database()] LOOP
         EXECUTE format('CREATE TRIGGER guard BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION f()', target);
       END LOOP;
     END $$;`,
  ]);
  assert.equal(triggers.size, 0);
});
