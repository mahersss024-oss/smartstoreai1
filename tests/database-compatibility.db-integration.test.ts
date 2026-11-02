import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseCompatibility } from '@/lib/admin/database-inspection';

test('the committed schema and applied PostgreSQL migrations pass the extended catalog checks', {
  skip: process.env.SMARTSTORE_DB_INTEGRATION !== '1' || !process.env.DATABASE_URL,
}, async () => {
  const result = await getDatabaseCompatibility();
  assert.deepEqual(result.migrations.pending, []);
  assert.deepEqual(result.migrations.failed, []);
  assert.deepEqual(result.schema.missingTables, []);
  assert.deepEqual(result.schema.missingColumns, []);
  assert.deepEqual(result.schema.mismatchedColumns, []);
  assert.deepEqual(result.schema.mismatchedNullability, []);
  assert.deepEqual(result.schema.missingKeys, []);
  assert.deepEqual(result.schema.mismatchedRelations, []);
  assert.deepEqual(result.schema.mismatchedEnums, []);
  assert.deepEqual(result.schema.unsupportedTypes, []);
  assert.equal(result.databaseObjects.expectedTriggers.length, 32);
  assert.ok(result.databaseObjects.expectedTriggers.includes('Listing.evidence_00_lock'));
  assert.ok(result.databaseObjects.expectedTriggers.includes('User.evidence_guard'));
  assert.deepEqual(result.databaseObjects.missingTriggers, []);
  assert.deepEqual(result.databaseObjects.disabledTriggers, []);
});
