import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { saveMobilePushRegistration, listActiveMobilePushTokensForUser, deactivateMobilePushToken } from '@/agent/marketplace/mobile-push-tokens';
import { parseMobilePushRemovalToken } from '@/lib/push/mobile-registration';
import { updateListingForSeller, deleteListingImageForSeller, setPrimaryListingImageForSeller, getConversationBlockStatus } from '@/agent/marketplace/repository';

test('PostgreSQL preserves explicit clearing, unique cover selection under concurrency, and both directions of blocking', async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return t.skip('Requires the dedicated local test database.');
  const target = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/smartstore_codex_test');
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const id = 'review-' + randomUUID(), seller = id + '-seller', buyer = id + '-buyer';
  try {
    await prisma.user.createMany({ data: [{ id: seller, email: seller + '@example.test' }, { id: buyer, email: buyer + '@example.test' }] });
    const token = id + '-native-token';
    const expired = await saveMobilePushRegistration({ userId: seller, token, platform: 'ios', sessionExpiresAt: new Date(Date.now() - 1000) });
    assert.equal((await listActiveMobilePushTokensForUser(seller)).length, 0);
    await saveMobilePushRegistration({ userId: seller, token, platform: 'ios', sessionExpiresAt: new Date(Date.now() + 60_000) });
    const proof = parseMobilePushRemovalToken(expired.removalToken, token)!;
    await deactivateMobilePushToken(token, seller, proof.registrationKey);
    assert.equal((await listActiveMobilePushTokensForUser(seller)).length, 1);
    await prisma.listing.create({ data: { id, sellerId: seller, category: 'other', title: 'Local review fixture', description: 'Old description', city: 'Old city', price: 100,
      compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false } } });
    await updateListingForSeller(id, seller, { description: null, city: null, price: null });
    const cleared = await prisma.listing.findUniqueOrThrow({ where: { id } });
    assert.equal(cleared.description, null); assert.equal(cleared.city, null); assert.equal(cleared.price, null); assert.equal(cleared.priceMode, null);
    await updateListingForSeller(id, seller, { title: 'Independent edit' });
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id } })).description, null);
    for (let iteration = 0; iteration < 4; iteration++) {
      const ids = ['P', 'A', 'B'].map(name => id + iteration + name);
      await prisma.listingImage.createMany({ data: ids.map((imageId, index) => ({ id: imageId, listingId: id, originalUrl: 'data:image/webp;base64,AA==', displayUrl: 'data:image/webp;base64,AA==', thumbnailUrl: 'data:image/webp;base64,AA==', isPrimary: index === 0, status: 'approved', qualityScore: 0, enhancements: [] })) });
      await Promise.all([deleteListingImageForSeller(id, seller, ids[0]), setPrimaryListingImageForSeller(id, seller, ids[2])]);
      assert.equal(await prisma.listingImage.count({ where: { listingId: id, isPrimary: true } }), 1);
      await prisma.listingImage.deleteMany({ where: { listingId: id } });
    }
    const conversation = await prisma.conversation.create({ data: { listingId: id, sellerId: seller, buyerId: buyer } });
    await prisma.userBlock.createMany({ data: [{ blockerId: seller, blockedId: buyer }, { blockerId: buyer, blockedId: seller }] });
    assert.equal((await getConversationBlockStatus(conversation.id, seller))?.blockedByMe, true);
    assert.equal((await getConversationBlockStatus(conversation.id, buyer))?.blockedByMe, true);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [seller, buyer] } } });
    await prisma.imageObjectCleanup.deleteMany({ where: { imageId: { startsWith: id } } });
  }
});
