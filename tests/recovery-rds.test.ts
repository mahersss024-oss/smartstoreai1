import assert from 'node:assert/strict';
import test from 'node:test';
import { type DBInstance, type DBSnapshot, type Tag } from '@aws-sdk/client-rds';
import { executeRecoveryRestore, getOwnedRecoveryTarget, getRecoveryRdsStatus, previewRecoveryRestore } from '@/lib/recovery/rds';
import { recoveryRestoreConfirmation, type RecoveryEnvironment, type RecoveryRdsClient } from '@/lib/recovery/types';

const now = Date.parse('2026-11-03T12:00:00.000Z');
const env: RecoveryEnvironment = { AUTH_SECRET: 'isolated-recovery-tests-secret-32-characters', SMARTSTORE_RECOVERY_ENABLED: '1',
  SMARTSTORE_RECOVERY_SECURITY_GROUP_IDS: 'sg-1234567890abcdef0', SMARTSTORE_RECOVERY_DB_SUBNET_GROUP: 'recovery-private' };
const sourceArn = 'arn:aws:rds:eu-central-1:102913100808:db:smartstore-db';
function fixture() {
  const source: DBInstance = { DBInstanceIdentifier: 'smartstore-db', DBInstanceArn: sourceArn, DbiResourceId: 'db-SOURCE123',
    Engine: 'postgres', EngineVersion: '17.11', DBInstanceStatus: 'available', DBInstanceClass: 'db.t4g.micro',
    DBSubnetGroup: { VpcId: 'vpc-source' }, StorageEncrypted: true,
    Endpoint: { Address: 'smartstore-db.synthetic.eu-central-1.rds.amazonaws.com', Port: 5432 },
    LatestRestorableTime: new Date(now - 60_000), BackupRetentionPeriod: 7 };
  const snapshot: DBSnapshot = { DBSnapshotIdentifier: 'manual-recovery-fixture', DBInstanceIdentifier: 'smartstore-db',
    DBSnapshotArn: 'arn:aws:rds:eu-central-1:102913100808:snapshot:manual-recovery-fixture', DbiResourceId: source.DbiResourceId,
    Engine: 'postgres', EngineVersion: source.EngineVersion, Status: 'available', SnapshotCreateTime: new Date(now - 3_600_000), SnapshotType: 'manual' };
  const targets = new Map<string, DBInstance>(); const tags = new Map<string, Tag[]>();
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let earliest = new Date(now - 86_400_000); let failure = '';
  const client = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name; const input = command.input; calls.push({ name, input });
    if (failure) throw new Error(failure);
    if (name === 'DescribeDBInstancesCommand') {
      if (!input.DBInstanceIdentifier) return { DBInstances: [source, ...targets.values()] };
      if (input.DBInstanceIdentifier === 'smartstore-db') return { DBInstances: [source] };
      const instance = targets.get(input.DBInstanceIdentifier as string);
      if (!instance) { const error = new Error('not found'); error.name = 'DBInstanceNotFoundFault'; throw error; }
      return { DBInstances: [instance] };
    }
    if (name === 'DescribeDBSnapshotsCommand') return { DBSnapshots: [snapshot] };
    if (name === 'DescribeDBInstanceAutomatedBackupsCommand') return { DBInstanceAutomatedBackups: [{ DbiResourceId: source.DbiResourceId,
      DBInstanceArn: source.DBInstanceArn, RestoreWindow: { EarliestTime: earliest, LatestTime: source.LatestRestorableTime } }] };
    if (name === 'ListTagsForResourceCommand') return { TagList: tags.get(input.ResourceName as string) ?? [] };
    if (name === 'RestoreDBInstanceFromDBSnapshotCommand' || name === 'RestoreDBInstanceToPointInTimeCommand') {
      const targetId = (input.DBInstanceIdentifier ?? input.TargetDBInstanceIdentifier) as string;
      const instance: DBInstance = { ...source, DBInstanceIdentifier: targetId, DBInstanceArn: `arn:aws:rds:eu-central-1:102913100808:db:${targetId}`,
        DbiResourceId: 'db-TARGET123', DBInstanceStatus: 'creating', PubliclyAccessible: false, InstanceCreateTime: new Date(now),
        DBSubnetGroup: { DBSubnetGroupName: 'recovery-private' }, VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-1234567890abcdef0' }],
        Endpoint: { Address: `${targetId}.synthetic.eu-central-1.rds.amazonaws.com`, Port: 5432 } };
      targets.set(targetId, instance); tags.set(instance.DBInstanceArn!, input.Tags as Tag[]); return { DBInstance: instance };
    }
    throw new Error('Unexpected command');
  } } as unknown as RecoveryRdsClient;
  return { source, snapshot, targets, tags, calls, client, options: { env, now, client },
    setEarliest(value: Date) { earliest = value; }, fail(value: string) { failure = value; } };
}
const execution = (previewToken: string) => ({ previewToken, confirmation: recoveryRestoreConfirmation, reason: 'Synthetic recovery drill', costAcknowledged: true });

test('recovery status is metadata-only, reports configuration, and never probes AWS with missing settings', async () => {
  const runtime = fixture();
  const missing = await getRecoveryRdsStatus({ ...runtime.options, env: { AUTH_SECRET: env.AUTH_SECRET } });
  assert.equal(missing.readStatus, 'not_configured'); assert.equal(runtime.calls.length, 0);
  const status = await getRecoveryRdsStatus({ ...runtime.options, env: { ...env, SMARTSTORE_RECOVERY_ENABLED: '0' } });
  assert.equal(status.readStatus, 'available'); assert.equal(status.enabled, false);
  assert.equal(status.source?.resourceId, 'db-SOURCE123'); assert.equal(status.snapshots.length, 1);
  assert.equal(status.source?.earliestRestoreTime, new Date(now - 86_400_000).toISOString());
  assert.ok(runtime.calls.every(call => /^(Describe|List)/.test(call.name)));
});

test('snapshot restore binds the owner preview to source identity and starts one private separately tagged target', async () => {
  const runtime = fixture();
  const preview = await previewRecoveryRestore('owner-fixture', { mode: 'snapshot', snapshotId: runtime.snapshot.DBSnapshotIdentifier }, runtime.options);
  assert.match(preview.targetId, /^souqhamad-recovery-[a-f0-9]{20}$/);
  assert.equal(Date.parse(preview.expiresAt) - now, 600_000);
  const result = await executeRecoveryRestore('owner-fixture', execution(preview.previewToken), runtime.options);
  assert.equal(result.targetId, preview.targetId); assert.equal(result.status, 'creating');
  const restore = runtime.calls.find(call => call.name === 'RestoreDBInstanceFromDBSnapshotCommand')!;
  assert.equal(restore.input.PubliclyAccessible, false); assert.equal(restore.input.MultiAZ, false);
  assert.equal(restore.input.DBSubnetGroupName, 'recovery-private');
  assert.deepEqual(restore.input.VpcSecurityGroupIds, ['sg-1234567890abcdef0']);
  assert.equal(restore.input.DBSnapshotIdentifier, runtime.snapshot.DBSnapshotArn);
  const tagText = JSON.stringify(restore.input.Tags);
  assert.match(tagText, /RecoveryAttestation/); assert.doesNotMatch(tagText, /owner-fixture|Synthetic recovery drill/);
  assert.ok(runtime.calls.every(call => !/Modify|Delete|CreateDBSnapshot/.test(call.name)));
  await executeRecoveryRestore('owner-fixture', execution(preview.previewToken), runtime.options);
  assert.equal(runtime.calls.filter(call => call.name === 'RestoreDBInstanceFromDBSnapshotCommand').length, 1);
});

test('restore refuses tampered, expired, foreign-owner or stale previews and never creates an unconfirmed resource', async () => {
  const runtime = fixture();
  const preview = await previewRecoveryRestore('owner-fixture', { mode: 'snapshot', snapshotId: runtime.snapshot.DBSnapshotIdentifier }, runtime.options);
  for (const [actorId, input, options] of [
    ['other-owner', execution(preview.previewToken), runtime.options],
    ['owner-fixture', execution(preview.previewToken + 'x'), runtime.options],
    ['owner-fixture', execution(preview.previewToken), { ...runtime.options, now: now + 600_001 }],
    ['owner-fixture', { ...execution(preview.previewToken), costAcknowledged: false }, runtime.options],
  ] as const) await assert.rejects(executeRecoveryRestore(actorId, input, options));
  runtime.source.DbiResourceId = 'db-REPLACEDSOURCE';
  await assert.rejects(executeRecoveryRestore('owner-fixture', execution(preview.previewToken), runtime.options), /recovery_preview_stale/);
  assert.equal(runtime.calls.filter(call => call.name.startsWith('Restore')).length, 0);
});

test('PITR uses an explicit checked restore instant and immutable source ID, then rechecks an expired backup window', async () => {
  const runtime = fixture(); const restoreTime = new Date(now - 120_000).toISOString();
  const preview = await previewRecoveryRestore('owner', { mode: 'point_in_time', restoreTime }, runtime.options);
  await executeRecoveryRestore('owner', execution(preview.previewToken), runtime.options);
  const command = runtime.calls.find(call => call.name === 'RestoreDBInstanceToPointInTimeCommand')!;
  assert.equal(command.input.SourceDbiResourceId, runtime.source.DbiResourceId);
  assert.equal(command.input.UseLatestRestorableTime, false);
  assert.equal((command.input.RestoreTime as Date).toISOString(), restoreTime);
  const second = await previewRecoveryRestore('owner', { mode: 'point_in_time', restoreTime }, runtime.options);
  runtime.setEarliest(new Date(now - 60_000));
  await assert.rejects(executeRecoveryRestore('owner', execution(second.previewToken), runtime.options), /recovery_selection_invalid/);
  assert.equal(runtime.calls.filter(call => call.name.startsWith('Restore')).length, 1);
});

test('restored target inspection proves signed AWS tags, owner, private networking and a distinct production identity', async () => {
  const runtime = fixture();
  const preview = await previewRecoveryRestore('owner', { mode: 'snapshot', snapshotId: runtime.snapshot.DBSnapshotIdentifier }, runtime.options);
  await executeRecoveryRestore('owner', execution(preview.previewToken), runtime.options);
  const target = runtime.targets.get(preview.targetId)!; target.DBInstanceStatus = 'available';
  const identity = await getOwnedRecoveryTarget('owner', preview.targetId, runtime.options);
  assert.equal(identity.targetResourceId, 'db-TARGET123'); assert.equal(identity.sourceResourceId, 'db-SOURCE123');
  await assert.rejects(getOwnedRecoveryTarget('other-owner', preview.targetId, runtime.options), /recovery_target_not_owned/);
  target.Endpoint = runtime.source.Endpoint;
  await assert.rejects(getOwnedRecoveryTarget('owner', preview.targetId, runtime.options), /recovery_target_identity_mismatch/);
  target.Endpoint = { Address: `${preview.targetId}.synthetic.eu-central-1.rds.amazonaws.com`, Port: 5432 };
  runtime.tags.set(target.DBInstanceArn!, []);
  await assert.rejects(executeRecoveryRestore('owner', execution(preview.previewToken), runtime.options), /recovery_target_not_owned/);
});

test('recovery rejects foreign snapshots and returns only stable safe provider errors', async () => {
  const runtime = fixture(); runtime.snapshot.DbiResourceId = 'db-FOREIGN';
  await assert.rejects(previewRecoveryRestore('owner', { mode: 'snapshot', snapshotId: 'manual-recovery-fixture' }, runtime.options), /recovery_snapshot_invalid/);
  runtime.fail('AWS credentials synthetic-private-access-key SQL secret row payload');
  await assert.rejects(previewRecoveryRestore('owner', { mode: 'snapshot', snapshotId: 'manual-recovery-fixture' }, runtime.options), error => {
    assert.equal((error as Error).message, 'recovery_service_unavailable'); return true;
  });
  const status = await getRecoveryRdsStatus(runtime.options);
  assert.equal(status.readStatus, 'unavailable'); assert.doesNotMatch(JSON.stringify(status), /private-access|SQL secret/);
});
