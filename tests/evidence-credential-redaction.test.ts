import assert from 'node:assert/strict';
import test from 'node:test';
import { readCaseEvidence } from '@/agent/marketplace/evidence';
import { prisma } from '@/lib/db/prisma';
import { redactEvidenceCredentials } from '@/lib/security/evidence-redaction';
import { mockDatabaseMethod } from './helpers/mock-database-method';

test('evidence credential redaction preserves evidence data and removes nested credentials without mutation', () => {
  const payload = { before: { id: 'account', name: 'Before', appleAuthorizationTokens: [{ ciphertext: 'private-before' }] },
    after: { id: 'account', name: 'After', appleAuthorizationTokens: [{ ciphertext: 'private-after' }],
      records: [null, 1, true, { appleAuthorizationTokens: [], retained: 'value' }] } };
  const original = structuredClone(payload);
  assert.deepEqual(redactEvidenceCredentials(payload), {
    before: { id: 'account', name: 'Before' },
    after: { id: 'account', name: 'After', records: [null, 1, true, { retained: 'value' }] },
  });
  assert.deepEqual(payload, original);
});

test('actual evidence responses omit historical credentials in snapshots and event payloads', async t => {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  const secret = { ciphertext: 'historical-private-ciphertext' };
  const snapshot = { participants: [{ id: 'account', name: 'Retained user', appleAuthorizationTokens: [secret] }], messages: [{ id: 'message', body: 'Retained message' }] };
  mockDatabaseMethod(t, prisma.evidenceCase, 'findUnique', async () => ({ id: 'case', sourceType: 'Report', sourceId: 'report', status: 'open', captureStatus: 'complete', snapshot, snapshotHash: 'original-integrity-hash' }));
  t.mock.method(prisma, '$queryRaw', async () => [{ valid: true }]);
  mockDatabaseMethod(t, prisma.evidenceAsset, 'findMany', async () => []);
  mockDatabaseMethod(t, prisma.evidenceEvent, 'findMany', async () => [{ id: 'event', action: 'User.update', payload: { before: { id: 'account', appleAuthorizationTokens: [secret] }, after: { id: 'account', name: 'Retained update' } } }]);
  mockDatabaseMethod(t, prisma.evidenceEvent, 'create', async () => ({ id: 'view-event' }));
  mockDatabaseMethod(t, prisma.user, 'findUnique', async () => ({ id: 'moderator' }));
  mockDatabaseMethod(t, prisma.adminAuditLog, 'create', async () => ({ id: 'audit' }));
  const response = await readCaseEvidence('Report', 'report', 'moderator', new Request('https://example.test/evidence'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('appleAuthorizationTokens'));
  assert.ok(!JSON.stringify(body).includes(secret.ciphertext));
  assert.equal(body.evidenceCase.snapshotHash, 'original-integrity-hash');
  assert.equal(body.evidenceCase.snapshot.messages[0].body, 'Retained message');
  assert.equal(body.events[0].payload.after.name, 'Retained update');
  assert.deepEqual(snapshot.participants[0].appleAuthorizationTokens, [secret]);
});
