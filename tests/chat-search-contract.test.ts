import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';
import { analyzeImageQuality } from '@/agent/marketplace/image-quality';

test('replayed customer turns reuse the saved draft and a new turn creates a distinct draft', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => textAnalysis());
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  const session = { user: { id: 'replay-owner', email: 'replay@example.test' }, issuedAt: 1, expiresAt: 9999999999 };
  const create = (requestKey: string) => createMarketplaceTools(session, { requestKey }).createListingDraft.execute! as unknown as (input: { category: string; title: string }, context: never) => Promise<{ listing: { id: string } }>;
  const first = await create('turn-a')({ category: 'other', title: 'Desk' }, {} as never);
  const replay = await create('turn-a')({ category: 'other', title: 'Different model wording' }, {} as never);
  const next = await create('turn-b')({ category: 'other', title: 'Desk' }, {} as never);
  assert.equal(replay.listing.id, first.listing.id);
  assert.notEqual(next.listing.id, first.listing.id);
});

test('metadata never invents visual quality measurements or rejects a small ordinary photo', () => {
  for (const dimensions of [{ width: 320, height: 240 }, { width: 1920, height: 1080 }]) {
    const result = analyzeImageQuality({ mimeType: 'image/jpeg', ...dimensions });
    assert.equal(result.assessmentStatus, 'not_measured');
    assert.equal(result.sharpness, 'unknown');
    assert.equal(result.lighting, 'unknown');
    assert.equal(result.productVisibility, 'unknown');
    assert.equal(result.listingImageStatus, 'approved');
  }
});
