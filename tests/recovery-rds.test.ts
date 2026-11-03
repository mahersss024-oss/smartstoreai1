import assert from 'node:assert/strict';
import test from 'node:test';
import { getRecoveryRdsStatus } from '@/lib/recovery/rds';
import type { RecoveryRdsClient } from '@/lib/recovery/types';

function fixture() {
  const calls: string[] = [];
  const source = { DBInstanceIdentifier: 'smartstore-db', DBInstanceArn: 'arn:aws:rds:eu-central-1:102913100808:db:smartstore-db',
    DbiResourceId: 'db-SOURCE', Engine: 'postgres', EngineVersion: '18.3', DBInstanceStatus: 'available', BackupRetentionPeriod: 7 };
  const snapshot = { DBInstanceIdentifier: source.DBInstanceIdentifier, DbiResourceId: source.DbiResourceId, Engine: 'postgres',
    DBSnapshotIdentifier: 'manual-fixture', DBSnapshotArn: 'arn:aws:rds:eu-central-1:102913100808:snapshot:manual-fixture',
    EngineVersion: '18.3', SnapshotCreateTime: new Date('2026-11-03T12:00:00Z'), Status: 'available', SnapshotType: 'manual' };
  const client = { send: async (command: { constructor: { name: string } }) => {
    const name = command.constructor.name; calls.push(name);
    if (name === 'DescribeDBInstancesCommand') return { DBInstances: [source] };
    if (name === 'DescribeDBSnapshotsCommand') return { DBSnapshots: [snapshot, { ...snapshot, DbiResourceId: 'db-FOREIGN' }] };
    if (name === 'DescribeDBInstanceAutomatedBackupsCommand') return { DBInstanceAutomatedBackups: [{ DbiResourceId: source.DbiResourceId,
      DBInstanceArn: source.DBInstanceArn, RestoreWindow: { EarliestTime: new Date('2026-10-29T12:00:00Z'), LatestTime: new Date('2026-11-03T12:00:00Z') } }] };
    throw new Error('A monitoring client must never execute a mutation.');
  } } as unknown as RecoveryRdsClient;
  return { source, calls, client };
}
test('legacy create-enable flags cannot enable RDS monitoring or execute any request', async () => {
  const runtime = fixture();
  for (const env of [{}, { SMARTSTORE_RECOVERY_ENABLED: '1', SMARTSTORE_RECOVERY_MEDIA_ENABLED: '1' }]) {
    const result = await getRecoveryRdsStatus({ env, client: runtime.client });
    assert.equal(result.enabled, false); assert.equal(result.monitoringOnly, true);
    assert.equal(result.readStatus, 'not_configured'); assert.deepEqual(result.targets, []);
  }
  assert.deepEqual(runtime.calls, []);
});
test('backup monitoring reads only Describe metadata, filters foreign snapshots and returns no endpoint or credentials', async () => {
  const runtime = fixture();
  const result = await getRecoveryRdsStatus({ env: { SMARTSTORE_RECOVERY_MONITORING_ENABLED: '1',
    SMARTSTORE_RECOVERY_ENABLED: '1', DATABASE_URL: 'postgresql://private-secret@host/db' }, client: runtime.client });
  assert.equal(result.readStatus, 'available'); assert.equal(result.source?.retentionDays, 7);
  assert.equal(result.source?.earliestRestoreTime, '2026-10-29T12:00:00.000Z');
  assert.equal(result.snapshots.length, 1); assert.equal(result.enabled, false);
  assert.ok(runtime.calls.every(name => name.startsWith('Describe')));
  assert.doesNotMatch(JSON.stringify(result), /private-secret|postgresql:|previewToken/);
});
test('metadata identity mismatches and provider failures conceal details without trying repairs', async () => {
  const runtime = fixture(); runtime.source.DBInstanceArn = 'arn:aws:rds:eu-central-1:000000000000:db:smartstore-db';
  const options = { env: { SMARTSTORE_RECOVERY_MONITORING_ENABLED: '1' }, client: runtime.client };
  assert.equal((await getRecoveryRdsStatus(options)).readStatus, 'unavailable');
  assert.deepEqual(runtime.calls, ['DescribeDBInstancesCommand']);
  const failed = await getRecoveryRdsStatus({ ...options, client: { send: async () => { throw new Error('PRIVATE AWS credential'); } } as unknown as RecoveryRdsClient });
  assert.equal(failed.readStatus, 'unavailable'); assert.equal(failed.enabled, false);
  assert.doesNotMatch(JSON.stringify(failed), /credential|PRIVATE/);
});
test('invalid monitoring configuration is rejected before making a provider request', async () => {
  const runtime = fixture();
  const result = await getRecoveryRdsStatus({ env: { SMARTSTORE_RECOVERY_MONITORING_ENABLED: '1', SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER: '../foreign' }, client: runtime.client });
  assert.equal(result.readStatus, 'unavailable'); assert.deepEqual(runtime.calls, []);
});
