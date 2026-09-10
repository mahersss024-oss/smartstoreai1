import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarketplaceTools } from '@/agent/tools/marketplace';
import {
  addListingImageForSeller,
  createListingDraft,
} from '@/agent/marketplace/store';
import type { AuthSession } from '@/lib/auth/session';

function createTestSession(userId: string): AuthSession {
  return {
    user: {
      id: userId,
      email: `${userId}@example.test`,
      name: userId,
    },
    issuedAt: 1,
    expiresAt: 9999999999,
  };
}

test('publishes the latest matching seller draft when listingId is omitted', async () => {
  const sellerId = 'seller:tool-publish-current-draft';
  const listing = createListingDraft({
    sellerId,
    category: 'cars',
    title: 'Toyota Camry',
  });

  addListingImageForSeller(listing.id, sellerId, {
    id: 'tool-publish-current-draft-image',
    listingId: listing.id,
    originalUrl: 'https://images.example.test/camry-original.jpg',
    displayUrl: 'https://images.example.test/camry-display.jpg',
    thumbnailUrl: 'https://images.example.test/camry-thumb.jpg',
    isPrimary: true,
    qualityScore: 92,
    status: 'approved',
    enhancements: [],
  });

  const tools = createMarketplaceTools(createTestSession(sellerId));
  const executeSetListingStatus = tools.setListingStatus.execute as unknown as (
    input: { status: 'published' },
    options: Record<string, never>,
  ) => Promise<{ status: string; listing: { id: string } }>;
  const result = await executeSetListingStatus(
    { status: 'published' },
    {},
  );

  assert.equal(result?.status, 'published');
  assert.equal(result?.listing.id, listing.id);
});
