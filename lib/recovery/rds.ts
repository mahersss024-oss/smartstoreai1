import { DescribeDBInstancesCommand, DescribeDBSnapshotsCommand, DescribeDBInstanceAutomatedBackupsCommand, RDSClient,
  type DBInstance } from '@aws-sdk/client-rds';
import type { RecoveryOptions, RecoveryRdsStatus } from './types';

let sharedClient: { region: string; client: RDSClient } | undefined;
const iso = (value: Date | undefined) => value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const empty: RecoveryRdsStatus = { configured: false, enabled: false, monitoringOnly: true,
  readStatus: 'not_configured', source: null, snapshots: [], targets: [] };

/** This module deliberately imports only AWS Describe operations. */
export async function getRecoveryRdsStatus(options: RecoveryOptions = {}): Promise<RecoveryRdsStatus> {
  const env = options.env ?? process.env;
  // Previous restore-enable flags have no effect on this read-only monitor.
  if (env.SMARTSTORE_RECOVERY_MONITORING_ENABLED !== '1') return { ...empty };
  const region = env.SMARTSTORE_RECOVERY_AWS_REGION?.trim() || 'eu-central-1';
  const account = env.SMARTSTORE_RECOVERY_ACCOUNT_ID?.trim() || '102913100808';
  const identifier = env.SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER?.trim() || 'smartstore-db';
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !/^\d{12}$/.test(account) || !/^[a-z][a-z0-9-]{0,62}$/.test(identifier)) {
    return { ...empty, readStatus: 'unavailable' };
  }
  try {
    if (!options.client && sharedClient?.region !== region) {
      sharedClient?.client.destroy();
      sharedClient = { region, client: new RDSClient({ region, maxAttempts: 2,
        requestHandler: { connectionTimeout: 3000, requestTimeout: 8000 } }) };
    }
    const client = options.client ?? sharedClient!.client;
    const expectedArn = `arn:aws:rds:${region}:${account}:db:${identifier}`;
    const source: DBInstance | undefined = (await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: identifier }))).DBInstances?.[0];
    if (!source || source.DBInstanceIdentifier !== identifier || source.DBInstanceArn !== expectedArn ||
      !source.DbiResourceId || source.Engine !== 'postgres') throw new Error('metadata_identity_mismatch');
    const [snapshots, backups] = await Promise.all([
      client.send(new DescribeDBSnapshotsCommand({ DBInstanceIdentifier: identifier, MaxRecords: 20 })),
      client.send(new DescribeDBInstanceAutomatedBackupsCommand({ DbiResourceId: source.DbiResourceId, MaxRecords: 20 })),
    ]);
    const backup = backups.DBInstanceAutomatedBackups?.find(item => item.DbiResourceId === source.DbiResourceId && item.DBInstanceArn === expectedArn);
    return { ...empty, configured: true, readStatus: 'available',
      source: { identifier, resourceId: source.DbiResourceId, engineVersion: source.EngineVersion ?? '', status: source.DBInstanceStatus ?? 'unknown',
        earliestRestoreTime: iso(backup?.RestoreWindow?.EarliestTime),
        latestRestoreTime: iso(backup?.RestoreWindow?.LatestTime ?? source.LatestRestorableTime), retentionDays: source.BackupRetentionPeriod ?? 0 },
      snapshots: (snapshots.DBSnapshots ?? []).filter(item => item.DBInstanceIdentifier === identifier &&
        item.DbiResourceId === source.DbiResourceId && item.DBSnapshotIdentifier &&
        item.DBSnapshotArn === `arn:aws:rds:${region}:${account}:snapshot:${item.DBSnapshotIdentifier}` && item.Engine === 'postgres')
        .sort((a, b) => (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0)).slice(0, 20)
        .map(item => ({ id: item.DBSnapshotIdentifier!, createdAt: iso(item.SnapshotCreateTime) ?? '',
          status: item.Status ?? 'unknown', type: item.SnapshotType ?? '', engineVersion: item.EngineVersion ?? '' })) };
  } catch { return { ...empty, configured: true, readStatus: 'unavailable' }; }
}
