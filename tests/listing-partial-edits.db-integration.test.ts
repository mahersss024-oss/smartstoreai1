import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { updateListingForSeller } from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';

// This exercises real PostgreSQL row locks only in the explicitly named local
// disposable database. The ordinary suite never opens a database connection.
test('PostgreSQL serializes partial listing merges without losing attributes or search text', async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') {
    t.skip('Opt in with the dedicated local PostgreSQL test database.');
    return;
  }
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  const suffix = randomUUID();
  const sellerId = `partial-edits-db-seller-${suffix}`;
  const listingId = `partial-edits-db-listing-${suffix}`;
  try {
    await prisma.user.create({ data: { id: sellerId, email: `partial-edits-${suffix}@example.test` } });
    await prisma.listing.create({ data: {
      id: listingId, sellerId, category: 'other', title: 'Original desk', description: 'Original description',
      price: 10, attributes: { color: 'black', material: 'wood' }, status: 'published',
      compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    } });
    const attributes = await Promise.all([
      updateListingForSeller(listingId, sellerId, { attributes: { color: 'white' } }),
      updateListingForSeller(listingId, sellerId, { attributes: { material: 'steel' } }),
    ]);
    assert.ok(attributes.every(Boolean));
    let saved = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    assert.deepEqual(saved.attributes, { color: 'white', material: 'steel' });
    const content = await Promise.all([
      updateListingForSeller(listingId, sellerId, { title: 'New desk' }),
      updateListingForSeller(listingId, sellerId, { price: 25 }),
    ]);
    assert.ok(content.every(Boolean));
    saved = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    assert.equal(saved.title, 'New desk');
    assert.equal(saved.price?.toNumber(), 25);
    assert.match(saved.searchText ?? '', /new desk/i);
    assert.doesNotMatch(saved.searchText ?? '', /original desk/i);
    assert.deepEqual(saved.attributes, { color: 'white', material: 'steel' });

    // A human decision committed before the seller obtains the edit lock must
    // remain authoritative after a later content-only change.
    await prisma.listing.update({ where: { id: listingId }, data: {
      status: 'rejected',
      compliance: { decision: 'block', humanDecision: 'block', reasons: ['Human decision'], jurisdiction: 'SA', shariaSensitive: false },
    } });
    const rejected = await updateListingForSeller(listingId, sellerId, { description: 'Customer corrected the description' });
    assert.equal(rejected?.status, 'rejected');
    assert.equal(rejected?.compliance.humanDecision, 'block');
    assert.equal(rejected?.compliance.decision, 'block');
  } finally {
    // Unique fixture-owned account only. Its listing has no financial/evidence
    // records, so the existing cascade removes only these local test fixtures.
    await prisma.user.deleteMany({ where: { id: sellerId } });
  }
});
