import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExplicitMarketplaceSearchIntent } from '@/agent/marketplace/structured-search-intent';
import { buildRetrievalTermGroups } from '@/agent/marketplace/retrieval-engine';
import { updateMarketplaceSearchState } from '@/agent/marketplace/search-state';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';
import { analyzeImageQuality } from '@/agent/marketplace/image-quality';

test('explicit brand and model remain title constraints alongside a product query', () => {
  const intent = parseExplicitMarketplaceSearchIntent('car', { brand: 'Toyota', model: 'Camry' });
  assert.deepEqual(buildRetrievalTermGroups({ ...intent, revision: 1, updatedAt: '' }), [['car'], ['toyota'], ['camry']]);
});

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

test('refinement can clear filters without losing the product or unrelated constraints', async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    await updateMarketplaceSearchState('clear-filter-test', parseExplicitMarketplaceSearchIntent('phone', { city: 'Riyadh', maxPrice: 900, condition: 'used', searchMode: 'new_search' }));
    const allCities = await updateMarketplaceSearchState('clear-filter-test', parseExplicitMarketplaceSearchIntent(undefined, { searchMode: 'refine', locationPreference: 'anywhere' }));
    assert.equal(allCities.city, undefined);
    assert.equal(allCities.maxPrice, 900);
    assert.deepEqual(allCities.terms, ['phone']);
    const noBudget = await updateMarketplaceSearchState('clear-filter-test', parseExplicitMarketplaceSearchIntent(undefined, { searchMode: 'refine', clearFilters: ['maxPrice'] }));
    assert.equal(noBudget.maxPrice, undefined);
    assert.equal(noBudget.condition, 'used');
    const next = await updateMarketplaceSearchState('clear-filter-test', parseExplicitMarketplaceSearchIntent('chair', { searchMode: 'new_search' }));
    assert.deepEqual(next.terms, ['chair']);
    assert.equal(next.condition, undefined);
    await updateMarketplaceSearchState('clear-brand-test', parseExplicitMarketplaceSearchIntent('Toyota car', { brand: 'Toyota', searchMode: 'new_search' }));
    const anyBrand = await updateMarketplaceSearchState('clear-brand-test', parseExplicitMarketplaceSearchIntent(undefined, { searchMode: 'refine', clearFilters: ['brand'] }));
    assert.equal(anyBrand.brand, undefined);
    assert.deepEqual(buildRetrievalTermGroups(anyBrand), [['car']]);
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
