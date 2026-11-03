import type { RDSClient } from '@aws-sdk/client-rds';
export class RecoveryError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export type RecoveryEnvironment = Record<string, string | undefined>;
export type RecoveryRdsClient = Pick<RDSClient, 'send'>;
export type RecoveryOptions = { env?: RecoveryEnvironment; client?: RecoveryRdsClient; now?: number };
export type RecoverySource = { identifier: string; resourceId: string; engineVersion: string; status: string;
  earliestRestoreTime: string | null; latestRestoreTime: string | null; retentionDays: number };
export type RecoveryRdsStatus = { configured: boolean; enabled: false; monitoringOnly: true;
  readStatus: 'available' | 'not_configured' | 'unavailable'; source: RecoverySource | null;
  snapshots: Array<{ id: string; createdAt: string; status: string; type: string; engineVersion: string }>;
  targets: Array<{ operationId: string; targetId: string; status: string; createdAt: string | null }> };
