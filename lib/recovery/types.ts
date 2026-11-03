import type { DBInstance, RDSClient } from '@aws-sdk/client-rds';

export const recoveryRestoreConfirmation = 'استعادة نسخة منفصلة';
export class RecoveryError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export type RecoveryEnvironment = Record<string, string | undefined>;
export type RecoveryRdsClient = Pick<RDSClient, 'send'>;
export type RecoveryOptions = { env?: RecoveryEnvironment; client?: RecoveryRdsClient; now?: number };
export type RecoverySelection = { mode: 'snapshot' | 'point_in_time'; snapshotId?: string; restoreTime?: string };
export type RecoverySource = { identifier: string; resourceId: string; engineVersion: string; status: string;
  earliestRestoreTime: string | null; latestRestoreTime: string | null; retentionDays: number };
export type RecoveryRdsStatus = { configured: boolean; enabled: boolean; readStatus: 'available' | 'not_configured' | 'unavailable';
  source: RecoverySource | null; snapshots: Array<{ id: string; createdAt: string; status: string; type: string; engineVersion: string }>;
  targets: Array<{ operationId: string; targetId: string; status: string; createdAt: string | null }> };
export type RecoveryPreview = { previewToken: string; expiresAt: string; confirmation: string; operationId: string; targetId: string;
  source: RecoverySource; selection: RecoverySelection; costWarning: string };
export type RecoveryExecuteInput = { previewToken: string; confirmation: string; reason: string; costAcknowledged: boolean };
export type RecoveryOperation = { operationId: string; targetId: string; status: string };
export type RecoveryClaim = { purpose: 'souqhamad-rds-recovery-v1'; actorId: string; issuedAt: number; operationId: string;
  targetId: string; sourceIdentifier: string; sourceResourceId: string; sourceArn: string; sourceEndpoint: string;
  fingerprint: string; selection: RecoverySelection };
export type RecoveryTargetIdentity = { operationId: string; targetId: string; targetArn: string; targetResourceId: string;
  endpoint: string; port: number; engineVersion: string; status: string; sourceResourceId: string; sourceArn: string;
  sourceEndpoint: string; selection: RecoverySelection; instance: DBInstance };
export type RestoredDatabaseReport = { operationId: string; targetId: string; checkedAt: string;
  status: 'passed' | 'attention'; tlsVerified: boolean; readOnly: boolean; engineVersion: string;
  migrations: { expected: number; applied: number; pending: string[]; unknown: string[]; failed: string[]; checksumMismatch: string[] };
  schema: { tablesChecked: number; issues: string[]; fingerprint: string };
  counts: Array<{ table: string; rows: number }>;
  foreignKeys: Array<{ relation: string; orphanRows: number }>;
  jobs: Array<{ kind: string; pending: number; failed: number; expiredLease: number }>;
  workersStarted: false; customerRowsReturned: false };
