import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketplaceTextAnalyzer, listingSemanticText, marketplaceTextAnalysisSchema, marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { resolveMarketplaceSearchUnderstanding } from '@/agent/marketplace/search-understanding';
import { listingCategoryClassifier } from '@/agent/marketplace/listing-category-model';
import { evaluateSaudiMarketplaceCompliance } from '@/agent/marketplace/policy';
import { getMarketplaceSearchTermVariants, parseMarketplaceSearchQuery } from '@/agent/marketplace/search';
import { getComparableListings, analyzeListingMarket } from '@/agent/marketplace/market-intelligence';
import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { updateMarketplaceSearchState } from '@/agent/marketplace/search-state';
import { buildRetrievalTermGroups } from '@/agent/marketplace/retrieval-engine';
import { parseStructuredSearchIntent } from '@/agent/marketplace/structured-search-intent';
import { searchMarketplaceWithState } from '@/agent/marketplace/search-engine';
import { createListingDraft } from '@/agent/marketplace/repository';
import { publishListing } from '@/agent/marketplace/store';
import { prepareListingUnderstanding } from '@/agent/marketplace/text-understanding';
import type { ListingRecord } from '@/agent/marketplace/store';
import { textAnalysis } from './helpers/text-understanding';

test('shared analysis deduplicates in-flight calls and expires without caching raw texts as keys', async () => {
  let calls = 0;
  let now = 100;
  const analyzer = createMarketplaceTextAnalyzer(async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return textAnalysis();
  }, { now: () => now });
  await Promise.all([analyzer.analyze('same text'), analyzer.analyze('same text')]);
  await analyzer.analyze('same text');
  assert.equal(calls, 1);
  await analyzer.analyze('changed text');
  assert.equal(calls, 2);
  now += 600001;
  assert.equal(analyzer.peek('same text'), null);
  await analyzer.analyze('same text');
  assert.equal(calls, 3);
});

test('invalid categories, errors, timeouts and oversized text do not invent analysis', async () => {
  assert.throws(() => marketplaceTextAnalysisSchema.parse({ ...textAnalysis(), category: 'invented' }));
  const failed = createMarketplaceTextAnalyzer(async () => { throw new Error('offline'); });
  assert.equal(await failed.analyze('a product'), null);
  let abort: AbortSignal | undefined;
  const stalled = createMarketplaceTextAnalyzer(async (_, signal) => {
    abort = signal;
    return new Promise(() => {});
  }, { timeoutMs: 10 });
  assert.equal(await stalled.analyze('a different product'), null);
  assert.equal(abort?.aborted, true);
  assert.equal(await stalled.analyze('x'.repeat(12001)), null);
});

test('unavailable analysis raises an advisory review signal without deciding publication', async t => {
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => null);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  const draft = await createListingDraft({ id: 'semantic-outage-owner', email: 'outage@example.test' },
    { category: 'other', title: 'Policy inspection unavailable', attributes: {} });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.compliance.checkStatus, 'unavailable');
  assert.equal(draft.compliance.modelAssessment?.unavailable, true);
  assert.equal(publishListing(draft.id)?.status, 'published');
});

test('candidate preparation gives later batches the remaining deadline instead of another full timeout', async t => {
  const originalNow = Date.now;
  let elapsed = 0;
  let calls = 0;
  t.mock.method(Date, 'now', () => originalNow() + elapsed);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async (_: string, remaining?: number) => {
    calls++;
    assert.ok(remaining !== undefined && remaining <= 6000);
    elapsed = 6001;
    return null;
  });
  await prepareListingUnderstanding(Array.from({ length: 50 }, (_, index) => ({ title: `candidate ${index}`, attributes: {} })));
  assert.equal(calls, 1);
});

test('model transport batches independent texts and rejects duplicate response IDs', async t => {
  let requests = 0;
  let invalid = false;
  t.mock.method(globalThis, 'fetch', async (_: unknown, init?: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.match(messages.find(message => message.role === 'system')!.content, /untrusted data/);
    const inputs = JSON.parse(messages.find(message => message.role === 'user')!.content);
    const items = inputs.map((input: { id: number }) => ({ id: invalid ? 0 : input.id, analysis: textAnalysis() }));
    return Response.json({ id: 'batch', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ items }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const analyzer = createMarketplaceTextAnalyzer();
  const values = await Promise.all([analyzer.analyze('independent batch A'), analyzer.analyze('independent batch B')]);
  assert.equal(requests, 1);
  assert.ok(values.every(Boolean));
  invalid = true;
  const rejected = await Promise.all([analyzer.analyze('invalid batch A'), analyzer.analyze('invalid batch B')]);
  assert.deepEqual(rejected, [null, null]);
});

test('explicit refinement retains contextual aliases and a new search clears them', async () => {
  const initial = parseStructuredSearchIntent('initial request');
  initial.terms = ['desk'];
  initial.termAliases = [{ term: 'desk', variants: ['bureau'] }];
  await updateMarketplaceSearchState('semantic-refinement', initial);
  const refine = parseStructuredSearchIntent('cheaper');
  refine.searchMode = 'refine';
  refine.terms = [];
  refine.maxPrice = 100;
  const state = await updateMarketplaceSearchState('semantic-refinement', refine);
  assert.deepEqual(buildRetrievalTermGroups(state), [['desk']]);
  const fresh = await updateMarketplaceSearchState('semantic-refinement', parseStructuredSearchIntent('new product'));
  assert.deepEqual(fresh.termAliases, []);
});

test('chat database search returns literal title matches without semantic removal of parts', async t => {
  const query = 'integration semantic furniture request';
  const whole = { category: 'furniture', title: 'unit semantic bureau fixed', price: 100, attributes: {} };
  const part = { category: 'furniture', title: 'unit semantic bureau fixed leg', price: 5, attributes: {} };
  const productAnalysis = textAnalysis({ category: 'furniture', product: 'desk' });
  const queryAnalysis = textAnalysis({ ...productAnalysis, intent: 'search_listing',
    aliases: [{ term: 'semantic-desk-fixture', variants: ['unit semantic bureau fixed'] }],
    search: { ...productAnalysis.search, descriptiveTerms: ['semantic-desk-fixture'] } });
  const outputs = new Map([
    [query, queryAnalysis], [listingSemanticText(whole), productAnalysis],
    [listingSemanticText(part), textAnalysis({ ...productAnalysis, offerKind: 'part' })],
  ]);
  const analyzer = createMarketplaceTextAnalyzer(async text => {
    const result = outputs.get(text);
    if (!result) throw new Error('No model fixture');
    return result;
  });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', analyzer.analyze);
  t.mock.method(marketplaceTextAnalyzer, 'peek', analyzer.peek);
  const owner = { id: 'semantic-integration-owner', email: 'semantic@example.test' };
  const savedWhole = await createListingDraft(owner, whole);
  const savedPart = await createListingDraft(owner, part);
  publishListing(savedWhole.id);
  publishListing(savedPart.id);
  const result = await searchMarketplaceWithState({ ownerKey: 'semantic-integration-search', query: 'bureau' });
  assert.ok(result.listings.some(item => item.listing.id === savedWhole.id));
  assert.ok(result.listings.some(item => item.listing.id === savedPart.id));
});

test('classification search aliases and contextual policy reuse one result', async t => {
  const input = { title: 'shared-analysis-title', description: 'shared-analysis-description', attributes: {} };
  const source = listingSemanticText(input);
  let calls = 0;
  const analyzer = createMarketplaceTextAnalyzer(async () => {
    calls++;
    return textAnalysis({ category: 'furniture', product: 'desk', aliases: [{ term: 'desk', variants: ['writing table'] }],
      search: { ...textAnalysis().search, descriptiveTerms: ['desk'] } });
  });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', analyzer.analyze);
  t.mock.method(marketplaceTextAnalyzer, 'peek', analyzer.peek);
  await analyzer.analyze(source);
  assert.equal((await listingCategoryClassifier.suggest(input)).category, 'furniture');
  assert.equal((await resolveMarketplaceSearchUnderstanding({ query: source }))?.category, 'furniture');
  assert.equal(evaluateSaudiMarketplaceCompliance(source).decision, 'allow');
  assert.deepEqual(parseMarketplaceSearchQuery(source).terms, ['desk']);
  assert.ok(getMarketplaceSearchTermVariants('desk', source).includes('writing table'));
  assert.equal(calls, 1);
  assert.equal(evaluateSaudiMarketplaceCompliance('not analyzed').decision, 'allow');
  assert.equal(evaluateSaudiMarketplaceCompliance('not analyzed').modelAssessment?.unavailable, true);
});

function listing(id: string, title: string, price: number): ListingRecord {
  return { id, title, price, category: 'furniture', sellerId: 'semantic-seller', attributes: {},
    images: [], status: 'published', views: 0, favoriteCount: 0, messageCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false } };
}

test('comparables use model identity and offer kind while price arithmetic stays deterministic', async t => {
  const target = listing('target', 'writing desk', 100);
  const equivalent = listing('same', 'bureau', 120);
  const part = listing('part', 'desk leg', 5);
  const unknown = listing('unknown', 'unrecognized', 500);
  const outputs = new Map([
    [listingSemanticText(target), textAnalysis({ product: 'desk' })],
    [listingSemanticText(equivalent), textAnalysis({ product: 'desk' })],
    [listingSemanticText(part), textAnalysis({ product: 'desk', offerKind: 'part' })],
  ]);
  t.mock.method(marketplaceTextAnalyzer, 'peek', (text: string) => outputs.get(text) ?? null);
  const comparables = getComparableListings(target, [part, unknown, equivalent]);
  assert.deepEqual(comparables.map(item => item.id), ['same']);
  const market = analyzeListingMarket(target, comparables);
  assert.equal(market.averageMarketPrice, 120);
  assert.equal(market.medianMarketPrice, 120);
  assert.equal(market.similarListingCount, 1);
});

test('contextual compliance keeps colors distinct from prohibited commerce', t => {
  const grey = '\u0643\u0646\u0628 \u0631\u0635\u0627\u0635\u064a';
  const prohibited = 'explicit ammunition sale';
  const outputs = new Map([
    [grey, textAnalysis()],
    [prohibited, textAnalysis({ compliance: { decision: 'block', reasons: ['weapons_ammunition'], shariaSensitive: false } })],
  ]);
  t.mock.method(marketplaceTextAnalyzer, 'peek', (text: string) => outputs.get(text) ?? null);
  assert.equal(evaluateSaudiMarketplaceCompliance(grey).decision, 'allow');
  assert.equal(evaluateSaudiMarketplaceCompliance(prohibited).decision, 'allow');
  assert.equal(evaluateSaudiMarketplaceCompliance(prohibited).modelAssessment?.decision, 'block');
});

test('low and unknown resolution are optional quality advice, not upload rejection', () => {
  for (const dimensions of [{ width: 1, height: 1 }, { width: 100, height: 100 }, {}]) {
    const result = analyzeImageQuality({ mimeType: 'image/jpeg', sizeBytes: 1000, ...dimensions });
    assert.equal(result.listingImageStatus, 'approved');
    assert.notEqual(result.recommendedAction, 'request_retake');
    assert.notEqual(result.recommendedAction, 'reject');
  }
  assert.equal(analyzeImageQuality({ mimeType: 'application/javascript' }).listingImageStatus, 'rejected');
});
