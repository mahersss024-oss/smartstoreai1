/* Independent recovery control plane. Source bindings are used only for list/get.
 * R2 bucket bindings themselves are not read-only permissions: deployment must
 * keep this Worker and its vault private and restrict who can edit the script.
 * No source PUT/DELETE, customer publication, or production cutover exists here.
 * A completed scan is per-object verified, not an atomic database/media snapshot.
 */
export const PAGE_SIZE = 25;
export const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
export const REQUEST_BODY_LIMIT = 4096;
export const API_SIGNATURE_WINDOW_MS = 120_000;
const MAX_RECORD_BYTES = 256 * 1024;
const LEASE_MS = 180_000;
const PAGE_BUDGET_MS = 60_000;
const OPERATION_TIMEOUT_MS = 15_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SOURCE_NAMES = ['listings', 'evidence', 'intake'];
const ZERO_HASH = '0'.repeat(64);
const PRIVATE = { cacheControl: 'private, no-store', contentType: 'application/json' };
const encoder = new TextEncoder();
const sourceBinding = name => ({ listings: 'LISTINGS', evidence: 'EVIDENCE', intake: 'INTAKE' })[name];
const runKey = id => `control/runs/${id}.json`;
const pageKey = (id, page) => `manifests/${id}/${String(page).padStart(12, '0')}.json`;
const entryKey = (id, page, index) => `entries/${id}/${String(page).padStart(12, '0')}/${index}.json`;
const dataKey = (id, source, keyHash, hash) => `backup-data/${id}/${source}/${keyHash}/${hash}`;
const quarantineKey = (id, source, keyHash, hash) => `quarantine/${id}/${source}/${keyHash}/${hash}`;
const currentTime = env => typeof env.__now === 'function' ? env.__now() : Date.now();

class RecoveryError extends Error {
  constructor(code, { retryable = true, status = 503 } = {}) { super(code); this.code = code; this.retryable = retryable; this.status = status; }
}
const fail = (code, status = 409) => new RecoveryError(code, { retryable: false, status });
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value)); }
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
async function verifyHmac(secret, text, signature) {
  if (!HASH.test(signature ?? '')) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = new Uint8Array(signature.match(/../g).map(value => Number.parseInt(value, 16)));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(text));
}
async function timed(work, timeout = OPERATION_TIMEOUT_MS) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new RecoveryError('storage_timeout')), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function limitedBytes(stream, maximum) {
  if (!stream) throw fail('body_missing');
  const reader = stream.getReader(); const chunks = []; let count = 0;
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new RecoveryError('storage_timeout');
      const chunk = await timed(reader.read(), remaining);
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > maximum) throw fail('body_too_large', 413);
      chunks.push(chunk.value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function configured(env) {
  return typeof env.RECOVERY_WORKER_SECRET === 'string' && env.RECOVERY_WORKER_SECRET.length >= 32 &&
    env.VAULT && env.JOBS && SOURCE_NAMES.every(name => env[sourceBinding(name)]);
}
function enabled(env) { return env.RECOVERY_MEDIA_ENABLED === '1'; }
async function authenticated(request, env, bytes) {
  const value = request.headers.get('X-Recovery-Timestamp') ?? '';
  if (!/^\d{13}$/.test(value)) return false;
  const timestamp = Number(value); const age = currentTime(env) - timestamp;
  if (age < -10_000 || age > API_SIGNATURE_WINDOW_MS) return false;
  const url = new URL(request.url);
  return verifyHmac(env.RECOVERY_WORKER_SECRET,
    `${value}\n${request.method}\n${url.pathname}\n${await sha256(bytes)}`, request.headers.get('X-Recovery-Signature'));
}
async function signedBytes(env, payload) {
  const contents = JSON.stringify(payload);
  return encoder.encode(JSON.stringify({ payload, signature: await hmac(env.RECOVERY_WORKER_SECRET, contents) }));
}
async function readRecord(env, key) {
  const object = await timed(env.VAULT.get(key));
  if (!object) return null;
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await limitedBytes(object.body, MAX_RECORD_BYTES))); }
  catch (error) { if (error instanceof RecoveryError && error.retryable) throw error; throw fail('record_invalid'); }
  if (!value || typeof value !== 'object' || !value.payload || !await verifyHmac(env.RECOVERY_WORKER_SECRET, JSON.stringify(value.payload), value.signature)) throw fail('record_invalid');
  return { value: value.payload, etag: object.etag };
}
async function immutableRecord(env, key, payload) {
  const bytes = await signedBytes(env, payload);
  const stored = await timed(env.VAULT.put(key, bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: PRIVATE }));
  if (stored) return stored;
  const existing = await readRecord(env, key);
  if (!existing || JSON.stringify(existing.value) !== JSON.stringify(payload)) throw fail('immutable_record_conflict');
  return existing;
}
async function saveState(env, held, next) {
  const stored = await timed(env.VAULT.put(runKey(next.id), await signedBytes(env, next), {
    onlyIf: { etagMatches: held.etag }, httpMetadata: PRIVATE,
  }));
  if (!stored) throw new RecoveryError('lease_lost');
  held.value = next; held.etag = stored.etag;
}
async function getRun(env, id) {
  if (!UUID.test(id ?? '')) throw fail('invalid_run_id', 400);
  const record = await readRecord(env, runKey(id));
  if (record && (record.value.id !== id || !['backup', 'quarantine_restore'].includes(record.value.kind))) throw fail('run_invalid');
  return record;
}
function summary(state) {
  return {
    runId: state.id, kind: state.kind, status: state.status, createdAt: state.createdAt,
    updatedAt: state.updatedAt, completedAt: state.completedAt ?? null,
    objects: state.objects, bytes: state.bytes, errors: state.errors,
    excludedObjects: state.excludedObjects, pages: state.page,
    ...(state.backupRunId ? { backupRunId: state.backupRunId } : {}),
    ...(state.status === 'completed' ? { manifestRoot: state.chainHash } : {}),
    fullyVerified: state.status === 'completed' && state.fullyVerified === true,
    quarantineOnly: true, productionCutoverAllowed: false, deletionReconciliation: 'required',
    ...(state.lastError ? { lastError: state.lastError } : {}),
    consistency: 'per_object_scan_not_database_point_in_time',
  };
}
function validSourceKey(source, key) {
  if (typeof key !== 'string' || !key || encoder.encode(key).byteLength > 1024 || /[\u0000-\u001f\u007f\\]/.test(key) || key.split('/').some(part => part === '.' || part === '..')) return false;
  if (source === 'evidence') return key.startsWith('cases/');
  if (source === 'intake') return /^staged\/v1\/[^/]+\/[^/]+\/(?:display|thumbnail)\.webp$/.test(key);
  if (source !== 'listings') return false;
  // Permanent legacy/profile JPEG or PNG is part of recovery; a file extension
  // does not prove it is an unprocessed original. Known raw/explicit-original
  // namespaces and variants are excluded without transforming or making originals.
  return /^(?:listings|profiles)\//.test(key) && /\.(?:webp|jpe?g|png)$/i.test(key) &&
    !/(?:^|\/)(?:raw|intake|original)(?:\/|\.)/i.test(key) && !/-original\./i.test(key);
}
export const isRecoverableSourceKey = validSourceKey;
function strictObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
async function ensureQueued(env, state) {
  await timed(env.JOBS.send({ runId: state.id }));
}
async function ensureIndex(env, state) {
  const timestamp = Date.parse(state.createdAt);
  if (!Number.isFinite(timestamp)) throw fail('run_time_invalid');
  const key = `control/index/${String(9_999_999_999_999 - timestamp).padStart(13, '0')}-${state.id}.json`;
  await immutableRecord(env, key, { id: state.id, createdAt: state.createdAt });
}
async function startRun(env, payload, kind) {
  if (!enabled(env)) throw fail('recovery_media_disabled', 503);
  const keys = kind === 'backup' ? ['requestId', 'sources'] : ['requestId', 'backupRunId'];
  if (!strictObject(payload, keys) || !UUID.test(payload.requestId ?? '')) throw fail('invalid_request', 400);
  if (kind === 'backup' && (!Array.isArray(payload.sources) || !payload.sources.length ||
    payload.sources.length > 3 || new Set(payload.sources).size !== payload.sources.length ||
    payload.sources.some(name => !SOURCE_NAMES.includes(name)))) throw fail('invalid_sources', 400);
  if (kind === 'quarantine_restore' && !UUID.test(payload.backupRunId ?? '')) throw fail('invalid_backup_run', 400);
  const sources = kind === 'backup' ? SOURCE_NAMES.filter(name => payload.sources.includes(name)) : undefined;
  const fingerprint = await sha256(JSON.stringify({ kind, ...(sources ? { sources } : { backupRunId: payload.backupRunId }) }));
  const previous = await getRun(env, payload.requestId);
  if (previous) {
    if (previous.value.requestFingerprint !== fingerprint) throw fail('request_id_conflict');
    await ensureIndex(env, previous.value);
    if (!['completed', 'failed'].includes(previous.value.status)) await ensureQueued(env, previous.value);
    return summary(previous.value);
  }
  let backup;
  if (kind === 'quarantine_restore') {
    backup = await getRun(env, payload.backupRunId);
    if (!backup || backup.value.kind !== 'backup' || backup.value.status !== 'completed' || !backup.value.fullyVerified) throw fail('backup_not_verified');
    const final = await readRecord(env, `manifests/${backup.value.id}/complete.json`);
    if (!final || final.value.root !== backup.value.chainHash || final.value.objects !== backup.value.objects || final.value.pages !== backup.value.page) throw fail('backup_manifest_invalid');
  }
  const timestamp = new Date(currentTime(env)).toISOString();
  const state = {
    schemaVersion: 1, id: payload.requestId, kind, requestFingerprint: fingerprint,
    sources: sources ?? backup.value.sources, ...(backup ? { backupRunId: backup.value.id, expectedPages: backup.value.page,
      expectedObjects: backup.value.objects, expectedBytes: backup.value.bytes, expectedRoot: backup.value.chainHash } : {}),
    createdAt: timestamp, updatedAt: timestamp, status: 'queued', objects: 0, bytes: 0, excludedObjects: 0,
    errors: 0, sourceIndex: 0, cursor: null, page: 0, chainHash: ZERO_HASH, pending: null, lease: null, fullyVerified: false,
  };
  const stored = await timed(env.VAULT.put(runKey(state.id), await signedBytes(env, state), {
    onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: PRIVATE,
  }));
  if (!stored) return startRun(env, payload, kind);
  // This index has only aggregate identifiers. A POST replay repairs a lost
  // enqueue, and scheduled() repairs enqueues that failed after durable creation.
  await ensureIndex(env, state);
  await ensureQueued(env, state);
  return summary(state);
}

async function readData(env, key, maximum = MAX_OBJECT_BYTES) {
  const object = await timed(env.VAULT.get(key));
  if (!object || object.size > maximum) throw fail('backup_object_missing_or_oversized');
  return { object, bytes: await limitedBytes(object.body, maximum) };
}
async function verifyStoredBytes(env, key, size, hash) {
  const stored = await readData(env, key);
  if (stored.bytes.byteLength !== size || await sha256(stored.bytes) !== hash) throw fail('stored_object_integrity_failed');
  return stored.bytes;
}
async function immutableBytes(env, key, bytes, hash, mediaType) {
  await timed(env.VAULT.put(key, bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: hash,
    httpMetadata: { cacheControl: 'private, no-store', contentType: mediaType || 'application/octet-stream' },
    customMetadata: { sha256: hash } }));
  await verifyStoredBytes(env, key, bytes.byteLength, hash);
}
async function backupEntry(env, state, candidate, index) {
  const marker = entryKey(state.id, state.page, index);
  const existing = await readRecord(env, marker);
  if (existing) {
    const entry = existing.value;
    if (entry.source !== candidate.source || entry.key !== candidate.key || !HASH.test(entry.sha256 ?? '') ||
      entry.keyHash !== await sha256(candidate.key) || entry.vaultKey !== dataKey(state.id, entry.source, entry.keyHash, entry.sha256)) throw fail('entry_invalid');
    await verifyStoredBytes(env, entry.vaultKey, entry.size, entry.sha256);
    return entry;
  }
  const object = await timed(env[sourceBinding(candidate.source)].get(candidate.key, { onlyIf: { etagMatches: candidate.etag } }));
  if (!object?.body || object.etag !== candidate.etag) { void object?.body?.cancel().catch(() => {}); throw fail('source_changed_or_missing'); }
  if (object.size > MAX_OBJECT_BYTES) { void object.body.cancel().catch(() => {}); throw fail('source_object_too_large'); }
  const bytes = await limitedBytes(object.body, MAX_OBJECT_BYTES);
  if (bytes.byteLength !== candidate.size) throw fail('source_size_changed');
  const hash = await sha256(bytes); const keyHash = await sha256(candidate.key);
  const vaultKey = dataKey(state.id, candidate.source, keyHash, hash);
  await immutableBytes(env, vaultKey, bytes, hash, object.httpMetadata?.contentType);
  const entry = { source: candidate.source, key: candidate.key, keyHash, sourceEtag: object.etag,
    uploadedAt: object.uploaded?.toISOString?.() ?? null, size: bytes.byteLength, sha256: hash, vaultKey };
  await immutableRecord(env, marker, entry);
  return entry;
}
async function prepareBackupPage(env, held) {
  const state = held.value;
  if (state.pending) return;
  const source = state.sources[state.sourceIndex];
  if (!SOURCE_NAMES.includes(source)) throw fail('run_source_invalid');
  const prefix = source === 'evidence' ? 'cases/' : source === 'intake' ? 'staged/v1/' : undefined;
  const listed = await timed(env[sourceBinding(source)].list({ limit: PAGE_SIZE,
    ...(prefix ? { prefix } : {}), ...(state.cursor ? { cursor: state.cursor } : {}) }));
  if (!Array.isArray(listed.objects) || listed.objects.length > PAGE_SIZE ||
    (listed.truncated && (typeof listed.cursor !== 'string' || !listed.cursor || listed.cursor === state.cursor))) throw fail('source_pagination_invalid');
  const entries = listed.objects.filter(object => validSourceKey(source, object.key)).map(object => ({
    source, key: object.key, size: object.size, etag: object.etag,
  }));
  if (entries.some(entry => !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.etag !== 'string')) throw fail('source_metadata_invalid');
  const pending = { entries, excluded: listed.objects.length - entries.length,
    nextCursor: listed.truncated ? listed.cursor : null, nextSourceIndex: listed.truncated ? state.sourceIndex : state.sourceIndex + 1 };
  await saveState(env, held, { ...state, pending });
}
async function processBackupPage(env, held, began) {
  await prepareBackupPage(env, held);
  const state = held.value; const entries = [];
  for (let index = 0; index < state.pending.entries.length; index++) {
    if (currentTime(env) - began > PAGE_BUDGET_MS) throw new RecoveryError('page_budget_exhausted');
    entries.push(await backupEntry(env, state, state.pending.entries[index], index));
  }
  const payload = { schemaVersion: 1, runId: state.id, page: state.page, previousHash: state.chainHash, entries };
  const pageHash = await sha256(JSON.stringify(payload));
  await immutableRecord(env, pageKey(state.id, state.page), { ...payload, hash: pageHash });
  await saveState(env, held, { ...state, sourceIndex: state.pending.nextSourceIndex, cursor: state.pending.nextCursor,
    page: state.page + 1, chainHash: pageHash, pending: null, excludedObjects: state.excludedObjects + state.pending.excluded,
    objects: state.objects + entries.length, bytes: state.bytes + entries.reduce((total, entry) => total + entry.size, 0) });
}
async function processRestorePage(env, held, began) {
  const state = held.value;
  const sealed = await readRecord(env, pageKey(state.backupRunId, state.page));
  if (!sealed) throw fail('backup_page_missing');
  const { hash, ...payload } = sealed.value;
  if (payload.runId !== state.backupRunId || payload.page !== state.page || payload.previousHash !== state.chainHash ||
    !Array.isArray(payload.entries) || payload.entries.length > PAGE_SIZE || await sha256(JSON.stringify(payload)) !== hash) throw fail('backup_page_integrity_failed');
  for (const entry of payload.entries) {
    if (currentTime(env) - began > PAGE_BUDGET_MS) throw new RecoveryError('page_budget_exhausted');
    if (!state.sources.includes(entry.source) || !validSourceKey(entry.source, entry.key) || !HASH.test(entry.sha256 ?? '') ||
      entry.keyHash !== await sha256(entry.key) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_OBJECT_BYTES ||
      entry.vaultKey !== dataKey(state.backupRunId, entry.source, entry.keyHash, entry.sha256)) throw fail('backup_entry_invalid');
    const bytes = await verifyStoredBytes(env, entry.vaultKey, entry.size, entry.sha256);
    await immutableBytes(env, quarantineKey(state.id, entry.source, entry.keyHash, entry.sha256), bytes, entry.sha256, 'application/octet-stream');
  }
  await saveState(env, held, { ...state, page: state.page + 1, chainHash: hash,
    objects: state.objects + payload.entries.length, bytes: state.bytes + payload.entries.reduce((total, entry) => total + entry.size, 0) });
}
async function completeRun(env, held) {
  const state = held.value;
  if (state.kind === 'quarantine_restore' && (state.page !== state.expectedPages || state.objects !== state.expectedObjects ||
    state.bytes !== state.expectedBytes || state.chainHash !== state.expectedRoot)) throw fail('restored_manifest_totals_mismatch');
  const completedAt = new Date(currentTime(env)).toISOString();
  await immutableRecord(env, `manifests/${state.id}/complete.json`, {
    schemaVersion: 1, runId: state.id, kind: state.kind, root: state.chainHash,
    pages: state.page, objects: state.objects, bytes: state.bytes, createdAt: state.createdAt,
    quarantineOnly: true, productionCutoverAllowed: false, deletionReconciliation: 'required',
  });
  await saveState(env, held, { ...state, status: 'completed', completedAt, updatedAt: completedAt, fullyVerified: true, lease: null });
}

export async function processRecoveryMessage(message, env) {
  if (!configured(env) || !enabled(env)) throw new RecoveryError('recovery_not_configured');
  const payload = message.body;
  if (!strictObject(payload, ['runId']) || !UUID.test(payload.runId ?? '')) { message.ack(); return; }
  const held = await getRun(env, payload.runId);
  if (!held) throw new RecoveryError('run_not_found');
  if (held.value.status === 'completed') { message.ack(); return; }
  if (held.value.status === 'failed') throw fail('run_failed');
  const now = currentTime(env);
  if (held.value.lease?.until > now) throw new RecoveryError('run_busy');
  const lease = { token: crypto.randomUUID(), until: now + LEASE_MS };
  await saveState(env, held, { ...held.value, lease, status: 'running', updatedAt: new Date(now).toISOString() });
  try {
    if (held.value.kind === 'backup') await processBackupPage(env, held, now);
    else if (held.value.kind === 'quarantine_restore') await processRestorePage(env, held, now);
    else throw fail('run_kind_invalid');
    const complete = held.value.kind === 'backup' ? held.value.sourceIndex === held.value.sources.length : held.value.page === held.value.expectedPages;
    if (complete) await completeRun(env, held);
    else {
      await saveState(env, held, { ...held.value, lease: null, updatedAt: new Date(currentTime(env)).toISOString() });
      await ensureQueued(env, held.value);
    }
    message.ack();
  } catch (error) {
    if (error?.code !== 'lease_lost') {
      const permanent = error instanceof RecoveryError && !error.retryable;
      await saveState(env, held, { ...held.value, status: permanent ? 'failed' : 'running', fullyVerified: false,
        errors: held.value.errors + 1, lastError: error instanceof RecoveryError ? error.code : 'storage_unavailable',
        lease: null, updatedAt: new Date(currentTime(env)).toISOString() }).catch(() => {});
    }
    throw error;
  }
}

async function recentRuns(env) {
  const listed = await timed(env.VAULT.list({ prefix: 'control/index/', limit: 20 }));
  const runs = [];
  for (const object of listed.objects) {
    const index = await readRecord(env, object.key);
    if (!UUID.test(index?.value?.id ?? '')) throw fail('run_index_invalid');
    const run = await getRun(env, index.value.id);
    if (run) runs.push(summary(run.value));
  }
  return runs;
}
async function fetchHandler(request, env) {
  if (!configured(env)) return json({ error: 'recovery_not_configured' }, 503);
  const url = new URL(request.url);
  if (url.search || url.hash) return json({ error: 'query_not_supported' }, 400);
  let bytes;
  try { bytes = request.body ? await limitedBytes(request.body, REQUEST_BODY_LIMIT) : new Uint8Array(); }
  catch { return json({ error: 'request_body_invalid' }, 413); }
  if (!await authenticated(request, env, bytes)) return json({ error: 'unauthorized' }, 401);
  if (request.method === 'GET' && bytes.length) return json({ error: 'unexpected_body' }, 400);
  if (request.method === 'GET' && url.pathname === '/v1/status') return json({
    configured: true, backupEnabled: enabled(env), runs: await recentRuns(env),
    quarantineOnly: true, productionCutoverAllowed: false, deletionReconciliation: 'required',
    scope: { permanentListingAndProfileImages: true, evidenceCases: true, stagedDeliveryWebP: true,
      rawIntakeExcluded: true, explicitlyNamedOriginalsExcluded: true },
    consistency: 'per_object_scan_not_database_point_in_time',
  });
  const match = url.pathname.match(/^\/v1\/(backups|restores)\/([a-f0-9-]{36})$/);
  if (request.method === 'GET' && match) {
    const run = await getRun(env, match[2]);
    if (!run || run.value.kind !== (match[1] === 'backups' ? 'backup' : 'quarantine_restore')) return json({ error: 'run_not_found' }, 404);
    return json(summary(run.value));
  }
  if (request.method === 'POST' && ['/v1/backups', '/v1/restores'].includes(url.pathname)) {
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw fail('invalid_json', 400); }
    return json(await startRun(env, payload, url.pathname === '/v1/backups' ? 'backup' : 'quarantine_restore'), 202);
  }
  return json({ error: 'route_not_found' }, 404);
}

const recoveryWorker = {
  async fetch(request, env) {
    try { return await fetchHandler(request, env); }
    catch (error) { return json({ error: error instanceof RecoveryError ? error.code : 'recovery_unavailable' }, error instanceof RecoveryError ? error.status : 503); }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try { await processRecoveryMessage(message, env); }
      catch (error) {
        console.warn(JSON.stringify({ event: 'recovery_job_retry', code: error instanceof RecoveryError ? error.code : 'storage_unavailable' }));
        message.retry({ delaySeconds: 30 });
      }
    }
  },
  async scheduled(_event, env) {
    if (!configured(env) || !enabled(env)) return;
    // This only repairs missing enqueue attempts for recent durable work. It
    // does not create automatic data-retaining backup generations or delete data.
    for (const run of await recentRuns(env)) if (['queued', 'running'].includes(run.status)) await ensureQueued(env, { id: run.runId });
  },
};
export default recoveryWorker;
