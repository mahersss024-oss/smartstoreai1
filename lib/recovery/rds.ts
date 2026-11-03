import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DescribeDBInstancesCommand, DescribeDBSnapshotsCommand, DescribeDBInstanceAutomatedBackupsCommand, ListTagsForResourceCommand,
  RestoreDBInstanceFromDBSnapshotCommand, RestoreDBInstanceToPointInTimeCommand, RDSClient,
  type DBInstance, type DBSnapshot, type Tag } from '@aws-sdk/client-rds';
import { RecoveryError, recoveryRestoreConfirmation, type RecoveryClaim, type RecoveryEnvironment,
  type RecoveryExecuteInput, type RecoveryOperation, type RecoveryOptions, type RecoveryPreview,
  type RecoveryRdsStatus, type RecoverySelection, type RecoverySource, type RecoveryTargetIdentity } from './types';

const purpose = 'souqhamad-rds-recovery-v1';
const targetPattern = /^souqhamad-recovery-[a-f0-9]{20}$/;
const ttl = 10 * 60_000;
const safeIdentifier = /^[a-z][a-z0-9-]{0,62}$/;
type Config = { region: string; account: string; source: string; enabled: boolean; secret: string;
  securityGroups: string[]; subnetGroup: string; instanceClass?: string };
type SourceInstance = DBInstance & { recoveryEarliestTime?: Date; recoveryLatestTime?: Date };
let sharedClient: { region: string; client: RDSClient } | undefined;

function configuration(env: RecoveryEnvironment): Config {
  const region = env.SMARTSTORE_RECOVERY_AWS_REGION?.trim() || 'eu-central-1';
  const account = env.SMARTSTORE_RECOVERY_ACCOUNT_ID?.trim() || '102913100808';
  const source = env.SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER?.trim() || 'smartstore-db';
  const securityGroups = [...new Set((env.SMARTSTORE_RECOVERY_SECURITY_GROUP_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean))].sort();
  const subnetGroup = env.SMARTSTORE_RECOVERY_DB_SUBNET_GROUP?.trim() || '';
  const instanceClass = env.SMARTSTORE_RECOVERY_DB_INSTANCE_CLASS?.trim() || undefined;
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !/^\d{12}$/.test(account) || !safeIdentifier.test(source) ||
    securityGroups.some(id => !/^sg-[a-f0-9]{8,17}$/.test(id)) || securityGroups.length > 5 ||
    subnetGroup && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(subnetGroup) ||
    instanceClass && !/^db\.[a-z0-9]+\.[a-z0-9]+$/.test(instanceClass)) throw new RecoveryError('recovery_configuration_invalid', 503);
  return { region, account, source, securityGroups, subnetGroup, instanceClass,
    enabled: env.SMARTSTORE_RECOVERY_ENABLED === '1', secret: env.AUTH_SECRET?.trim() || '' };
}
function signingKey(config: Config) {
  if (config.secret.length < 32) throw new RecoveryError('recovery_not_configured', 503);
  return config.secret;
}
function configured(config: Config) { return config.secret.length >= 32 && config.securityGroups.length > 0 && Boolean(config.subnetGroup); }
function runtime(options: RecoveryOptions) {
  const env = options.env ?? process.env;
  const config = configuration(env);
  if (!options.client && sharedClient?.region !== config.region) {
    sharedClient?.client.destroy();
    sharedClient = { region: config.region, client: new RDSClient({ region: config.region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 12_000 } }) };
  }
  return { env, config, client: options.client ?? sharedClient!.client, now: options.now ?? Date.now() };
}
function iso(date: Date | undefined) { return date && Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function sourceSummary(source: SourceInstance): RecoverySource {
  return { identifier: source.DBInstanceIdentifier!, resourceId: source.DbiResourceId!, status: source.DBInstanceStatus ?? 'unknown',
    engineVersion: source.EngineVersion ?? '', earliestRestoreTime: iso(source.recoveryEarliestTime),
    latestRestoreTime: iso(source.recoveryLatestTime ?? source.LatestRestorableTime), retentionDays: source.BackupRetentionPeriod ?? 0 };
}
function arn(config: Config, kind: 'db' | 'snapshot', name: string) { return `arn:aws:rds:${config.region}:${config.account}:${kind}:${name}`; }
function sourceIdentity(source: DBInstance | undefined, config: Config): asserts source is DBInstance {
  if (!source || source.DBInstanceIdentifier !== config.source || source.DBInstanceArn !== arn(config, 'db', config.source) ||
    !/^db-[A-Z0-9]+$/i.test(source.DbiResourceId ?? '') || source.Engine !== 'postgres' || !source.EngineVersion ||
    !source.Endpoint?.Address || !/^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(source.Endpoint.Address) ||
    source.Endpoint.Port !== 5432) throw new RecoveryError('recovery_source_identity_mismatch', 409);
}
function fingerprint(config: Config, source: DBInstance) {
  return createHash('sha256').update(JSON.stringify({ region: config.region, account: config.account, source: config.source,
    sourceArn: source.DBInstanceArn, resourceId: source.DbiResourceId, endpoint: source.Endpoint?.Address,
    engine: source.Engine, engineVersion: source.EngineVersion, vpc: source.DBSubnetGroup?.VpcId,
    encrypted: source.StorageEncrypted, kms: source.KmsKeyId, securityGroups: config.securityGroups,
    subnetGroup: config.subnetGroup, instanceClass: config.instanceClass ?? source.DBInstanceClass })).digest('hex');
}
function hmac(config: Config, body: string) { return createHmac('sha256', signingKey(config)).update(`${purpose}:${body}`).digest('base64url'); }
function sameSignature(actual: string, expected: string) {
  const left = Buffer.from(actual, 'base64url'); const right = Buffer.from(expected, 'base64url');
  return left.length === right.length && timingSafeEqual(left, right);
}
function signClaim(claim: RecoveryClaim, config: Config) {
  const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${body}.${hmac(config, body)}`;
}
function readClaim(token: string, actorId: string, config: Config, now: number): RecoveryClaim {
  signingKey(config);
  try {
    if (typeof token !== 'string' || token.length > 12_000) throw new Error();
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra || !sameSignature(signature, hmac(config, body))) throw new Error();
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RecoveryClaim;
    if (claim.purpose !== purpose || claim.actorId !== actorId || !Number.isSafeInteger(claim.issuedAt) ||
      claim.issuedAt > now || now - claim.issuedAt > ttl || !/^[a-f0-9]{20}$/.test(claim.operationId) ||
      claim.targetId !== `souqhamad-recovery-${claim.operationId}` || !/^[a-f0-9]{64}$/.test(claim.fingerprint) ||
      !claim.selection || !['snapshot', 'point_in_time'].includes(claim.selection.mode)) throw new Error();
    return claim;
  } catch { throw new RecoveryError('recovery_preview_invalid', 409); }
}
async function describeSource(client: ReturnType<typeof runtime>['client'], config: Config) {
  const response = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: config.source }));
  const source = response.DBInstances?.[0]; sourceIdentity(source, config); return source as SourceInstance;
}
async function restoreWindow(client: ReturnType<typeof runtime>['client'], source: SourceInstance) {
  const response = await client.send(new DescribeDBInstanceAutomatedBackupsCommand({ DbiResourceId: source.DbiResourceId, MaxRecords: 20 }));
  const backup = response.DBInstanceAutomatedBackups?.find(value => value.DbiResourceId === source.DbiResourceId && value.DBInstanceArn === source.DBInstanceArn);
  source.recoveryEarliestTime = backup?.RestoreWindow?.EarliestTime;
  source.recoveryLatestTime = backup?.RestoreWindow?.LatestTime;
}
function snapshotIdentity(snapshot: DBSnapshot | undefined, source: DBInstance, config: Config): asserts snapshot is DBSnapshot {
  if (!snapshot || snapshot.Status !== 'available' || snapshot.Engine !== 'postgres' || snapshot.EngineVersion !== source.EngineVersion ||
    snapshot.DBInstanceIdentifier !== config.source || snapshot.DbiResourceId !== source.DbiResourceId ||
    !snapshot.DBSnapshotIdentifier || snapshot.DBSnapshotArn !== arn(config, 'snapshot', snapshot.DBSnapshotIdentifier)) {
    throw new RecoveryError('recovery_snapshot_invalid', 409);
  }
}
async function selectionFor(client: ReturnType<typeof runtime>['client'], config: Config, source: SourceInstance,
  selection: RecoverySelection, now: number): Promise<RecoverySelection> {
  if (selection.mode === 'snapshot' && selection.snapshotId && !selection.restoreTime && selection.snapshotId.length <= 256) {
    const result = await client.send(new DescribeDBSnapshotsCommand({ DBSnapshotIdentifier: selection.snapshotId }));
    const snapshot = result.DBSnapshots?.[0]; snapshotIdentity(snapshot, source, config);
    return { mode: 'snapshot', snapshotId: snapshot.DBSnapshotArn! };
  }
  if (selection.mode === 'point_in_time' && selection.restoreTime && !selection.snapshotId &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(selection.restoreTime)) {
    await restoreWindow(client, source);
    const time = Date.parse(selection.restoreTime);
    if (Number.isFinite(time) && time <= now && source.recoveryEarliestTime && source.recoveryLatestTime &&
      time >= source.recoveryEarliestTime.getTime() && time <= source.recoveryLatestTime.getTime()) {
      return { mode: 'point_in_time', restoreTime: new Date(time).toISOString() };
    }
  }
  throw new RecoveryError('recovery_selection_invalid', 400);
}
const actorHash = (actorId: string, config: Config) => hmac(config, `actor:${actorId}`);
function claimTags(claim: RecoveryClaim, config: Config): Tag[] {
  const fields: Record<string, string> = { RecoveryPurpose: purpose, RecoveryRunId: claim.operationId,
    RecoveryTargetId: claim.targetId, RecoverySourceId: claim.sourceResourceId, RecoverySourceArn: claim.sourceArn,
    RecoverySourceHost: claim.sourceEndpoint, RecoveryActor: actorHash(claim.actorId, config),
    RecoveryIssuedAt: String(claim.issuedAt), RecoverySelection: JSON.stringify(claim.selection), RecoveryConfig: claim.fingerprint };
  if (Object.values(fields).some(value => value.length > 256)) throw new RecoveryError('recovery_selection_invalid', 400);
  const body = JSON.stringify(fields);
  return [...Object.entries(fields).map(([Key, Value]) => ({ Key, Value })), { Key: 'RecoveryAttestation', Value: hmac(config, `receipt:${body}`) }];
}
function receiptFromTags(tags: Tag[], config: Config) {
  const keys = ['RecoveryPurpose', 'RecoveryRunId', 'RecoveryTargetId', 'RecoverySourceId', 'RecoverySourceArn', 'RecoverySourceHost',
    'RecoveryActor', 'RecoveryIssuedAt', 'RecoverySelection', 'RecoveryConfig'];
  const map = new Map(tags.map(tag => [tag.Key, tag.Value]));
  const fields = Object.fromEntries(keys.map(key => [key, map.get(key) ?? '']));
  if (fields.RecoveryPurpose !== purpose || !targetPattern.test(fields.RecoveryTargetId) ||
    fields.RecoveryTargetId !== `souqhamad-recovery-${fields.RecoveryRunId}` || !fields.RecoverySourceId ||
    !sameSignature(map.get('RecoveryAttestation') ?? '', hmac(config, `receipt:${JSON.stringify(fields)}`))) {
    throw new RecoveryError('recovery_target_not_owned', 409);
  }
  let selection: RecoverySelection;
  try { selection = JSON.parse(fields.RecoverySelection); } catch { throw new RecoveryError('recovery_target_not_owned', 409); }
  return { fields, selection };
}
async function targetTags(client: ReturnType<typeof runtime>['client'], instance: DBInstance) {
  if (!instance.DBInstanceArn) throw new RecoveryError('recovery_target_identity_mismatch', 409);
  const response = await client.send(new ListTagsForResourceCommand({ ResourceName: instance.DBInstanceArn }));
  return response.TagList ?? [];
}
function notFound(error: unknown) { return error instanceof Error && ['DBInstanceNotFound', 'DBInstanceNotFoundFault'].includes(error.name); }
async function existingTarget(client: ReturnType<typeof runtime>['client'], targetId: string) {
  try { return (await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: targetId }))).DBInstances?.[0] ?? null; }
  catch (error) { if (notFound(error)) return null; throw error; }
}
function safeFailure(error: unknown): never {
  if (error instanceof RecoveryError) throw error;
  throw new RecoveryError('recovery_service_unavailable', 503);
}

export async function getRecoveryRdsStatus(options: RecoveryOptions = {}): Promise<RecoveryRdsStatus> {
  let enabled = false; let ready = false;
  try {
    const { client, config } = runtime(options); enabled = config.enabled; ready = configured(config);
    if (!ready) return { configured: false, enabled, readStatus: 'not_configured', source: null, snapshots: [], targets: [] };
    const source = await describeSource(client, config);
    await restoreWindow(client, source);
    const snapshots = await client.send(new DescribeDBSnapshotsCommand({ DBInstanceIdentifier: config.source, MaxRecords: 20 }));
    const instances = await client.send(new DescribeDBInstancesCommand({ MaxRecords: 100 }));
    const targets: RecoveryRdsStatus['targets'] = [];
    if (config.secret.length >= 32) for (const instance of instances.DBInstances ?? []) {
      if (!targetPattern.test(instance.DBInstanceIdentifier ?? '') || instance.DBInstanceArn !== arn(config, 'db', instance.DBInstanceIdentifier!) ||
        instance.DbiResourceId === source.DbiResourceId) continue;
      try {
        const receipt = receiptFromTags(await targetTags(client, instance), config);
        if (receipt.fields.RecoverySourceId !== source.DbiResourceId || receipt.fields.RecoverySourceArn !== source.DBInstanceArn ||
          receipt.fields.RecoveryTargetId !== instance.DBInstanceIdentifier) continue;
        targets.push({ operationId: receipt.fields.RecoveryRunId, targetId: instance.DBInstanceIdentifier!,
          status: instance.DBInstanceStatus ?? 'unknown', createdAt: iso(instance.InstanceCreateTime) });
      } catch { /* Unattested instances are never presented as our restored targets. */ }
    }
    return { configured: ready, enabled, readStatus: 'available', source: sourceSummary(source),
      snapshots: (snapshots.DBSnapshots ?? []).filter(snapshot => {
        try { snapshotIdentity(snapshot, source, config); return true; } catch { return false; }
      }).sort((a, b) => (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0)).slice(0, 20)
        .map(snapshot => ({ id: snapshot.DBSnapshotIdentifier!, createdAt: iso(snapshot.SnapshotCreateTime) ?? '',
          status: snapshot.Status!, type: snapshot.SnapshotType ?? '', engineVersion: snapshot.EngineVersion! })),
      targets: targets.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 20) };
  } catch { return { configured: ready, enabled, readStatus: ready ? 'unavailable' : 'not_configured', source: null, snapshots: [], targets: [] }; }
}

export async function previewRecoveryRestore(actorId: string, input: RecoverySelection, options: RecoveryOptions = {}): Promise<RecoveryPreview> {
  try {
    const { client, config, now } = runtime(options);
    if (!config.enabled) throw new RecoveryError('recovery_disabled', 503);
    if (!configured(config)) throw new RecoveryError('recovery_not_configured', 503);
    if (!actorId || actorId.length > 200) throw new RecoveryError('recovery_actor_invalid', 403);
    const source = await describeSource(client, config);
    if (source.DBInstanceStatus !== 'available') throw new RecoveryError('recovery_source_unavailable', 409);
    const selection = await selectionFor(client, config, source, input, now);
    const operationId = randomBytes(10).toString('hex');
    const claim: RecoveryClaim = { purpose, actorId, issuedAt: now, operationId, targetId: `souqhamad-recovery-${operationId}`,
      sourceIdentifier: config.source, sourceResourceId: source.DbiResourceId!, sourceArn: source.DBInstanceArn!,
      sourceEndpoint: source.Endpoint!.Address!, fingerprint: fingerprint(config, source), selection };
    claimTags(claim, config);
    return { previewToken: signClaim(claim, config), expiresAt: new Date(now + ttl).toISOString(),
      confirmation: recoveryRestoreConfirmation, operationId, targetId: claim.targetId, source: sourceSummary(source), selection,
      costWarning: 'تنشئ الاستعادة قاعدة منفصلة برسوم AWS مستقلة؛ لا تغيّر قاعدة الإنتاج أو اتصال التطبيق.' };
  } catch (error) { return safeFailure(error); }
}

export async function executeRecoveryRestore(actorId: string, input: RecoveryExecuteInput, options: RecoveryOptions = {}): Promise<RecoveryOperation> {
  try {
    const { client, config, now } = runtime(options);
    if (!config.enabled) throw new RecoveryError('recovery_disabled', 503);
    if (!configured(config)) throw new RecoveryError('recovery_not_configured', 503);
    if (input.confirmation !== recoveryRestoreConfirmation || input.costAcknowledged !== true ||
      typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new RecoveryError('recovery_confirmation_required', 400);
    const claim = readClaim(input.previewToken, actorId, config, now);
    const source = await describeSource(client, config);
    if (source.DbiResourceId !== claim.sourceResourceId || source.DBInstanceArn !== claim.sourceArn ||
      source.Endpoint?.Address !== claim.sourceEndpoint || claim.sourceIdentifier !== config.source ||
      fingerprint(config, source) !== claim.fingerprint) throw new RecoveryError('recovery_preview_stale', 409);
    const selection = await selectionFor(client, config, source, claim.selection, now);
    if (JSON.stringify(selection) !== JSON.stringify(claim.selection)) throw new RecoveryError('recovery_preview_stale', 409);
    const expectedTags = claimTags(claim, config);
    const resume = async (instance: DBInstance): Promise<RecoveryOperation> => {
      if (instance.DBInstanceIdentifier !== claim.targetId || instance.DBInstanceArn !== arn(config, 'db', claim.targetId) ||
        instance.DbiResourceId === source.DbiResourceId) throw new RecoveryError('recovery_target_identity_mismatch', 409);
      const tags = await targetTags(client, instance);
      receiptFromTags(tags, config);
      if (expectedTags.some(expected => !tags.some(tag => tag.Key === expected.Key && tag.Value === expected.Value))) throw new RecoveryError('recovery_target_not_owned', 409);
      return { operationId: claim.operationId, targetId: claim.targetId, status: instance.DBInstanceStatus ?? 'creating' };
    };
    const existing = await existingTarget(client, claim.targetId);
    if (existing) return resume(existing);
    const common = { DBInstanceClass: config.instanceClass ?? source.DBInstanceClass,
      DBSubnetGroupName: config.subnetGroup, VpcSecurityGroupIds: config.securityGroups,
      PubliclyAccessible: false, MultiAZ: false, DeletionProtection: true, CopyTagsToSnapshot: true, Tags: expectedTags };
    try {
      const response = claim.selection.mode === 'snapshot'
        ? await client.send(new RestoreDBInstanceFromDBSnapshotCommand({ ...common, DBInstanceIdentifier: claim.targetId, DBSnapshotIdentifier: claim.selection.snapshotId! }))
        : await client.send(new RestoreDBInstanceToPointInTimeCommand({ ...common, TargetDBInstanceIdentifier: claim.targetId,
          SourceDbiResourceId: source.DbiResourceId, RestoreTime: new Date(claim.selection.restoreTime!), UseLatestRestorableTime: false }));
      if (!response.DBInstance) throw new RecoveryError('recovery_start_unconfirmed', 503);
      return await resume(response.DBInstance);
    } catch (error) {
      // A concurrent replay may win creation, or the response may be lost. The
      // existing target is resumable only after verifying every signed receipt tag.
      const after = await existingTarget(client, claim.targetId);
      if (after) return resume(after);
      throw error;
    }
  } catch (error) { return safeFailure(error); }
}

export async function getOwnedRecoveryTarget(actorId: string, targetId: string, options: RecoveryOptions = {}): Promise<RecoveryTargetIdentity> {
  try {
    if (!targetPattern.test(targetId)) throw new RecoveryError('recovery_target_invalid', 400);
    const { client, config } = runtime(options); signingKey(config);
    const source = await describeSource(client, config);
    const target = await existingTarget(client, targetId);
    if (!target || target.DBInstanceIdentifier !== targetId || target.DBInstanceArn !== arn(config, 'db', targetId) ||
      !target.DbiResourceId || target.DbiResourceId === source.DbiResourceId || target.DBInstanceArn === source.DBInstanceArn ||
      target.Endpoint?.Address === source.Endpoint?.Address || target.Engine !== 'postgres' || target.PubliclyAccessible !== false) {
      throw new RecoveryError('recovery_target_identity_mismatch', 409);
    }
    const receipt = receiptFromTags(await targetTags(client, target), config);
    if (receipt.fields.RecoveryActor !== actorHash(actorId, config) || receipt.fields.RecoverySourceId !== source.DbiResourceId ||
      receipt.fields.RecoverySourceArn !== source.DBInstanceArn || receipt.fields.RecoverySourceHost !== source.Endpoint!.Address ||
      receipt.fields.RecoveryTargetId !== targetId) throw new RecoveryError('recovery_target_not_owned', 409);
    if (target.DBInstanceStatus !== 'available' || !target.Endpoint?.Address || target.Endpoint.Port !== 5432 ||
      !/^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(target.Endpoint.Address) || !target.EngineVersion ||
      target.DBSubnetGroup?.DBSubnetGroupName !== config.subnetGroup ||
      JSON.stringify((target.VpcSecurityGroups ?? []).map(group => group.VpcSecurityGroupId).sort()) !== JSON.stringify(config.securityGroups)) {
      throw new RecoveryError('recovery_target_not_ready', 409);
    }
    return { operationId: receipt.fields.RecoveryRunId, targetId, targetArn: target.DBInstanceArn!, targetResourceId: target.DbiResourceId,
      endpoint: target.Endpoint.Address, port: target.Endpoint.Port, engineVersion: target.EngineVersion,
      status: target.DBInstanceStatus, sourceResourceId: source.DbiResourceId!, sourceArn: source.DBInstanceArn!,
      sourceEndpoint: source.Endpoint!.Address!, selection: receipt.selection, instance: target };
  } catch (error) { return safeFailure(error); }
}
