import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker, { isRecoverableSourceKey, MAX_OBJECT_BYTES, PAGE_SIZE, processRecoveryMessage } from './worker.mjs';

const SECRET = 'offline-recovery-contract-secret-only-0000000000';
const now = Date.parse('2026-11-03T10:00:00Z');
const utf8 = value => new TextEncoder().encode(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const message = id => ({ body: { runId: id }, acknowledged: false, retried: false,
  ack() { this.acknowledged = true; }, retry() { this.retried = true; } });

class Bucket {
  objects = new Map();
  calls = [];
  fault = null;
  seed(key, content, type = 'image/webp') {
    const bytes = typeof content === 'string' ? utf8(content) : new Uint8Array(content);
    this.objects.set(key, { bytes: bytes.slice(), etag: digest(bytes), uploaded: new Date(now),
      httpMetadata: { contentType: type }, customMetadata: {} });
  }
  metadata(key) {
    const object = this.objects.get(key);
    return object ? { key, etag: object.etag, size: object.bytes.byteLength, uploaded: object.uploaded,
      httpMetadata: object.httpMetadata, customMetadata: object.customMetadata } : null;
  }
  async put(key, contents, options = {}) {
    this.calls.push({ method: 'put', key });
    if (this.fault) await this.fault('put', key);
    const existing = this.objects.get(key);
    const condition = options.onlyIf;
    if (condition instanceof Headers && condition.get('If-None-Match') === '*' && existing) return null;
    if (condition?.etagMatches && condition.etagMatches !== existing?.etag) return null;
    const bytes = typeof contents === 'string' ? utf8(contents) : new Uint8Array(contents);
    if (options.sha256) assert.equal(digest(bytes), options.sha256, 'R2 upload checksum must be actual SHA-256, never an ETag');
    this.seed(key, bytes, options.httpMetadata?.contentType);
    this.objects.get(key).customMetadata = { ...options.customMetadata };
    return this.metadata(key);
  }
  async get(key, options = {}) {
    this.calls.push({ method: 'get', key });
    if (this.fault) await this.fault('get', key);
    const object = this.objects.get(key);
    if (!object) return null;
    const metadata = this.metadata(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object.etag) return metadata;
    const bytes = object.bytes.slice();
    return { ...metadata, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  }
  async list(options = {}) {
    this.calls.push({ method: 'list', options });
    if (this.fault) await this.fault('list', options.prefix ?? '');
    const keys = [...this.objects.keys()].filter(key => key.startsWith(options.prefix ?? '') &&
      (!options.cursor || key > options.cursor)).sort();
    const chosen = keys.slice(0, options.limit ?? 1000);
    const truncated = keys.length > chosen.length;
    return { objects: chosen.map(key => this.metadata(key)), truncated,
      ...(truncated ? { cursor: chosen.at(-1) } : {}) };
  }
  async delete() { throw new Error('Recovery must never delete source or vault objects.'); }
}

function environment() {
  return { RECOVERY_WORKER_SECRET: SECRET, RECOVERY_MEDIA_ENABLED: '1', __now: () => now,
    VAULT: new Bucket(), LISTINGS: new Bucket(), EVIDENCE: new Bucket(), INTAKE: new Bucket(),
    JOBS: { items: [], fail: false, async send(body) { if (this.fail) throw new Error('Synthetic queue unavailable'); this.items.push(structuredClone(body)); } } };
}
function signedRequest(env, pathname, payload, overrides = {}) {
  const method = payload === undefined ? 'GET' : 'POST';
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = String(overrides.timestamp ?? env.__now());
  const signature = createHmac('sha256', SECRET).update(`${timestamp}\n${method}\n${pathname}\n${digest(Buffer.from(body))}`).digest('hex');
  return new Request(`https://recovery.example.invalid${pathname}`, { method,
    headers: { 'X-Recovery-Timestamp': timestamp, 'X-Recovery-Signature': overrides.signature ?? signature },
    ...(method === 'POST' ? { body } : {}) });
}
async function request(env, pathname, payload, overrides) {
  const response = await worker.fetch(signedRequest(env, pathname, payload, overrides), env);
  return { status: response.status, body: await response.json() };
}
async function startBackup(env, id = randomUUID(), sources = ['listings', 'evidence', 'intake']) {
  const result = await request(env, '/v1/backups', { requestId: id, sources });
  assert.equal(result.status, 202);
  return id;
}
async function drain(env, budget = 100) {
  let steps = 0;
  while (env.JOBS.items.length) {
    if (++steps > budget) throw new Error('Unexpected unbounded recovery queue.');
    const item = env.JOBS.items.shift();
    const msg = message(item.runId);
    await processRecoveryMessage(msg, env);
    assert.equal(msg.acknowledged, true);
  }
  return steps;
}
const records = env => [...env.VAULT.objects.values()].filter(object => object.httpMetadata.contentType === 'application/json')
  .map(object => JSON.parse(new TextDecoder().decode(object.bytes)));
const sourceWrites = env => [env.LISTINGS, env.EVIDENCE, env.INTAKE].flatMap(bucket => bucket.calls.filter(call => call.method === 'put'));

test('recovery API authenticates timestamp, method, path and raw body and never returns private object keys', async () => {
  const env = environment();
  env.LISTINGS.seed('listings/2026/11/private-customer-image.webp', 'private bytes');
  assert.equal((await request(env, '/v1/status', undefined, { signature: '0'.repeat(64) })).status, 401);
  assert.equal((await request(env, '/v1/status', undefined, { timestamp: now - 120001 })).status, 401);
  assert.equal((await request(env, '/v1/status', undefined, { timestamp: now + 10001 })).status, 401);
  const original = signedRequest(env, '/v1/backups', { requestId: randomUUID(), sources: ['listings'] });
  const tampered = new Request('https://recovery.example.invalid/v1/backups', {
    method: 'POST', headers: original.headers, body: JSON.stringify({ requestId: randomUUID(), sources: ['evidence'] }),
  });
  assert.equal((await worker.fetch(tampered, env)).status, 401);
  const status = await request(env, '/v1/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.productionCutoverAllowed, false);
  assert.equal(status.body.deletionReconciliation, 'required');
  assert.doesNotMatch(JSON.stringify(status.body), /private-customer|private bytes|offline-recovery-contract-secret/);
  assert.equal(env.VAULT.objects.size, 0, 'GET status must not create jobs or persist state');
});

test('strict sources, closed payloads, body limits and disabled controls refuse unsafe work before enqueuing', async () => {
  const env = environment();
  for (const payload of [
    { requestId: randomUUID(), sources: ['arbitrary'] },
    { requestId: randomUUID(), sources: ['listings', 'listings'] },
    { requestId: randomUUID(), sources: ['listings'], endpoint: 'https://attacker.invalid/' },
    { requestId: '../../foreign', sources: ['listings'] },
  ]) assert.equal((await request(env, '/v1/backups', payload)).status, 400);
  assert.equal((await request(env, '/v1/backups', { requestId: randomUUID(), sources: ['listings'], extra: 'x'.repeat(5000) })).status, 413);
  env.RECOVERY_MEDIA_ENABLED = '0';
  assert.equal((await request(env, '/v1/backups', { requestId: randomUUID(), sources: ['listings'] })).status, 503);
  assert.equal(env.JOBS.items.length, 0);
  assert.equal(env.VAULT.objects.size, 0);
});

test('backup uses bounded pages, keeps permanent legacy/profile files, and excludes raw and explicit originals', async () => {
  const env = environment();
  for (let index = 0; index < PAGE_SIZE * 2 + 3; index++) {
    env.LISTINGS.seed(`listings/2026/11/${String(index).padStart(4, '0')}-display.webp`, `photo-${index}`);
  }
  env.LISTINGS.seed('profiles/owners/test/avatar.jpeg', 'processed profile', 'image/jpeg');
  env.LISTINGS.seed('listings/2026/11/legacy.png', 'legacy permanent image', 'image/png');
  env.LISTINGS.seed('listings/raw/original.jpg', 'raw forbidden');
  env.LISTINGS.seed('listings/2026/11/test-original.webp', 'explicit original forbidden');
  env.LISTINGS.seed('listings/2026/11/original.webp', 'explicit original forbidden');
  env.INTAKE.seed('intake/v1/raw.jpg', 'raw forbidden');
  env.INTAKE.seed('staged/v1/upload/lease/display.webp', 'staged display');
  env.INTAKE.seed('staged/v1/upload/lease/thumbnail.webp', 'staged thumbnail');
  env.INTAKE.seed('staged/v1/upload/lease/original.webp', 'staged original forbidden');
  env.EVIDENCE.seed('cases/report-1/snapshot.json', '{"privateEvidence":true}', 'application/json');
  env.EVIDENCE.seed('other/foreign.json', 'out of scope');
  const id = await startBackup(env);
  assert.ok(await drain(env) >= 5, 'More than one queue invocation must handle a source with many objects');
  const result = await request(env, `/v1/backups/${id}`);
  assert.equal(result.body.status, 'completed');
  assert.equal(result.body.fullyVerified, true);
  assert.equal(result.body.objects, 58);
  assert.equal(result.body.excludedObjects, 4);
  assert.equal(result.body.quarantineOnly, true);
  assert.equal(result.body.productionCutoverAllowed, false);
  assert.equal(result.body.consistency, 'per_object_scan_not_database_point_in_time');
  for (const bucket of [env.LISTINGS, env.EVIDENCE, env.INTAKE]) {
    assert.ok(bucket.calls.filter(call => call.method === 'list').every(call => call.options.limit === PAGE_SIZE));
  }
  assert.equal(sourceWrites(env).length, 0);
  const entries = records(env).flatMap(record => record.payload?.entries ?? []);
  assert.ok(entries.some(entry => entry.key.endsWith('/avatar.jpeg')));
  assert.ok(entries.some(entry => entry.key.endsWith('/legacy.png')));
  assert.ok(!entries.some(entry => /original|intake\/v1/.test(entry.key)));
  assert.doesNotMatch(JSON.stringify(result.body), /avatar|legacy|privateEvidence|snapshot\.json/);
});

test('request replay repairs lost queue sends and remains idempotent while conflicting request IDs fail', async () => {
  const env = environment(); const id = randomUUID();
  env.JOBS.fail = true;
  assert.equal((await request(env, '/v1/backups', { requestId: id, sources: ['listings'] })).status, 503);
  env.JOBS.fail = false;
  assert.equal((await request(env, '/v1/backups', { requestId: id, sources: ['listings'] })).status, 202);
  assert.equal((await request(env, '/v1/backups', { requestId: id, sources: ['evidence'] })).status, 409);
  await drain(env);
  const count = env.VAULT.objects.size;
  const replay = await request(env, '/v1/backups', { requestId: id, sources: ['listings'] });
  assert.equal(replay.body.status, 'completed');
  assert.equal(env.VAULT.objects.size, count);
  assert.equal(env.JOBS.items.length, 0);
  const status = await request(env, '/v1/status');
  assert.deepEqual(status.body.runs.map(run => run.runId), [id]);
});

test('a partial copy failure retains durable entries and never exposes a false completed checkpoint', async () => {
  const env = environment();
  env.LISTINGS.seed('listings/a-display.webp', 'first');
  env.LISTINGS.seed('listings/b-display.webp', 'second');
  const id = await startBackup(env, undefined, ['listings']);
  let writes = 0;
  env.VAULT.fault = async (method, key) => { if (method === 'put' && key.startsWith('backup-data/') && ++writes === 2) throw new Error('Synthetic interrupted upload'); };
  const item = env.JOBS.items.shift();
  await assert.rejects(processRecoveryMessage(message(item.runId), env));
  const partial = await request(env, `/v1/backups/${id}`);
  assert.equal(partial.body.status, 'running');
  assert.equal(partial.body.fullyVerified, false);
  assert.equal(partial.body.errors, 1);
  assert.equal(env.VAULT.objects.has(`manifests/${id}/complete.json`), false);
  env.VAULT.fault = null;
  await processRecoveryMessage(message(id), env);
  assert.equal((await request(env, `/v1/backups/${id}`)).body.status, 'completed');
  assert.equal((await request(env, `/v1/backups/${id}`)).body.objects, 2);
  assert.equal(sourceWrites(env).length, 0);
});

test('duplicates cannot double-count an already committed manifest page or replace verified objects', async () => {
  const env = environment();
  env.LISTINGS.seed('listings/a.webp', 'first');
  const id = await startBackup(env, undefined, ['listings']);
  await drain(env);
  const snapshot = new Map([...env.VAULT.objects].filter(([key]) => key.startsWith('backup-data/')).map(([key, object]) => [key, digest(object.bytes)]));
  const duplicate = message(id);
  await processRecoveryMessage(duplicate, env);
  assert.equal(duplicate.acknowledged, true);
  assert.equal((await request(env, `/v1/backups/${id}`)).body.objects, 1);
  for (const [key, hash] of snapshot) assert.equal(digest(env.VAULT.objects.get(key).bytes), hash);
});

test('restoration verifies every manifest page and byte then writes only quarantine inside the private vault', async () => {
  const env = environment();
  env.LISTINGS.seed('listings/a.webp', 'picture');
  env.EVIDENCE.seed('cases/private/file.bin', 'evidence', 'application/octet-stream');
  const backupId = await startBackup(env);
  await drain(env);
  const id = randomUUID();
  const started = await request(env, '/v1/restores', { requestId: id, backupRunId: backupId });
  assert.equal(started.status, 202);
  await drain(env);
  const result = await request(env, `/v1/restores/${id}`);
  assert.equal(result.body.status, 'completed');
  assert.equal(result.body.fullyVerified, true);
  assert.equal(result.body.objects, 2);
  assert.equal(result.body.manifestRoot, (await request(env, `/v1/backups/${backupId}`)).body.manifestRoot);
  assert.equal(result.body.deletionReconciliation, 'required');
  assert.equal(result.body.productionCutoverAllowed, false);
  assert.equal([...env.VAULT.objects.keys()].filter(key => key.startsWith(`quarantine/${id}/`)).length, 2);
  assert.equal(sourceWrites(env).length, 0);
});

test('changed source, corrupt archived bytes or corrupt manifest never yield a verified restoration', async () => {
  const env = environment(); env.LISTINGS.seed('listings/a.webp', 'original transformed picture');
  const id = await startBackup(env, undefined, ['listings']);
  let changed = false;
  env.LISTINGS.fault = async method => {
    if (method === 'get' && !changed) { changed = true; env.LISTINGS.seed('listings/a.webp', 'changed'); }
  };
  await assert.rejects(processRecoveryMessage(message(id), env), /source_changed_or_missing/);
  assert.equal((await request(env, `/v1/backups/${id}`)).body.status, 'failed');
  assert.equal((await request(env, '/v1/restores', { requestId: randomUUID(), backupRunId: id })).status, 409);

  for (const corrupt of ['bytes', 'manifest']) {
    const safe = environment(); safe.LISTINGS.seed('listings/a.webp', 'backup picture');
    const backupId = await startBackup(safe, undefined, ['listings']); await drain(safe);
    if (corrupt === 'bytes') {
      const key = [...safe.VAULT.objects.keys()].find(value => value.startsWith('backup-data/'));
      safe.VAULT.seed(key, 'tampered bytes');
    } else {
      const key = [...safe.VAULT.objects.keys()].find(value => /manifests\/.*\/000000000000\.json/.test(value));
      safe.VAULT.seed(key, '{"payload":{"private":"SECRET"},"signature":"' + '0'.repeat(64) + '"}', 'application/json');
    }
    const restoreId = randomUUID();
    assert.equal((await request(safe, '/v1/restores', { requestId: restoreId, backupRunId: backupId })).status, 202);
    await assert.rejects(processRecoveryMessage(message(restoreId), safe));
    const result = await request(safe, `/v1/restores/${restoreId}`);
    assert.equal(result.body.fullyVerified, false);
    assert.equal(result.body.status, 'failed');
    assert.doesNotMatch(JSON.stringify(result.body), /SECRET|tampered bytes/);
    assert.equal(sourceWrites(safe).length, 0);
  }
});

test('record tampering, excessive object sizes and foreign queue payloads fail closed', async () => {
  const env = environment(); const id = await startBackup(env, undefined, ['listings']);
  env.VAULT.seed(`control/runs/${id}.json`, '{"payload":{"id":"' + id + '"},"signature":"' + '0'.repeat(64) + '"}', 'application/json');
  assert.equal((await request(env, `/v1/backups/${id}`)).status, 409);
  const wrong = message('../../foreign');
  await processRecoveryMessage(wrong, env);
  assert.equal(wrong.acknowledged, true);
  const big = environment(); big.LISTINGS.seed('listings/huge.webp', new Uint8Array(MAX_OBJECT_BYTES + 1));
  const bigId = await startBackup(big, undefined, ['listings']);
  await assert.rejects(processRecoveryMessage(message(bigId), big), /source_object_too_large/);
  assert.equal((await request(big, `/v1/backups/${bigId}`)).body.status, 'failed');
});

test('scheduled repair requeues durable work without creating a new generation or fetching customer files', async () => {
  const env = environment();
  const id = await startBackup(env); env.JOBS.items.length = 0;
  await worker.scheduled({}, env);
  assert.deepEqual(env.JOBS.items, [{ runId: id }]);
  assert.ok([env.LISTINGS, env.EVIDENCE, env.INTAKE].every(bucket => bucket.calls.length === 0));
  assert.equal(records(env).filter(record => record.payload?.kind === 'backup').length, 1);
});

test('a concurrent delivery cannot acquire an active lease or double count copied files', async () => {
  const env = environment(); env.LISTINGS.seed('listings/a.webp', 'single verified picture');
  const id = await startBackup(env, undefined, ['listings']);
  let release; let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  env.LISTINGS.fault = async method => { if (method === 'get') { entered(); await held; } };
  const first = processRecoveryMessage(message(id), env);
  await waiting;
  try { await assert.rejects(processRecoveryMessage(message(id), env), /run_busy/); }
  finally { release(); }
  await first; await drain(env);
  const result = await request(env, `/v1/backups/${id}`);
  assert.equal(result.body.status, 'completed'); assert.equal(result.body.objects, 1);
  assert.equal([...env.VAULT.objects.keys()].filter(key => key.startsWith('backup-data/')).length, 1);
  assert.equal(sourceWrites(env).length, 0);
});

test('a stalled request body is bounded and cannot enqueue cloud work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = environment();
  const pending = worker.fetch(new Request('https://recovery.example.invalid/v1/backups', {
    method: 'POST', duplex: 'half', body: new ReadableStream({ start() {} }),
  }), env);
  t.mock.timers.tick(15_001);
  const response = await pending;
  assert.equal(response.status, 413); assert.equal(env.JOBS.items.length, 0);
  t.mock.timers.reset();
});

test('scope and deployment configuration keep sources and live delivery isolated from recovery writes', () => {
  assert.equal(isRecoverableSourceKey('listings', 'profiles/owners/user/avatar.png'), true);
  assert.equal(isRecoverableSourceKey('listings', 'listings/2026/11/file.webp'), true);
  assert.equal(isRecoverableSourceKey('listings', 'listings/../secret.webp'), false);
  assert.equal(isRecoverableSourceKey('intake', 'intake/v1/upload.jpg'), false);
  assert.equal(isRecoverableSourceKey('intake', 'staged/v1/upload/lease/original.webp'), false);
  assert.equal(isRecoverableSourceKey('intake', 'staged/v1/upload/lease/display.webp'), true);
  const config = readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"RECOVERY_MEDIA_ENABLED": "0"/);
  assert.match(config, /"max_concurrency": 1/);
  assert.match(config, /"max_batch_size": 1/);
  assert.match(config, /"dead_letter_queue": "souqhamad-recovery-jobs-dlq"/);
  assert.match(config, /"bucket_name": "souqhamad-recovery-vault"/);
  const source = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /env\[(?:sourceBinding|candidate\.source).*?\.put\(/);
});
