import assert from 'node:assert/strict';
import test from 'node:test';
import { platformCapabilities, renderPlatformCapabilitiesForPrompt } from '@/agent/platform-capabilities';
import { createMarketplaceTools, createReadOnlyMarketplaceTools } from '@/agent/tools/marketplace';
import { getPlatformHelp, platformHelpTopics } from '@/agent/platform-guide';
import { platformPolicies } from '@/lib/platform/policies';
import { systemPrompt } from '@/agent/system-prompt';
import { marketplaceSystemInstructions } from '@/agent/marketplace/agents';

test('Hamad exposes only documented help and owned unpublished draft tools', () => {
  const expected = ['addUploadedImagesToListing', 'analyzeListingImages', 'createListingDraft', 'getPlatformHelp', 'updateListing'];
  assert.deepEqual(Object.keys(createMarketplaceTools(null)).sort(), expected);
  assert.deepEqual(Object.keys(createReadOnlyMarketplaceTools()), ['getPlatformHelp']);
  assert.deepEqual([...new Set(platformCapabilities.flatMap(capability => capability.allowedTools))].sort(), expected);
  assert.ok(platformCapabilities.every(capability => capability.requiresAuth));
  for (const removed of ['searchMarketplaceListings', 'compareMarketplaceListings', 'estimateListingPrice', 'evaluateNegotiationOffer', 'setListingStatus', 'openMarketplaceConversation', 'sendMessage']) {
    assert.ok(!(removed in createMarketplaceTools(null)), removed);
  }
});

test('help reads the same policy objects rendered by public pages, not a second generated policy', () => {
  for (const [topic, key] of [['terms', 'terms'], ['privacy', 'privacy'], ['listing_policy', 'listings'], ['commissions', 'commissions'], ['deletion', 'deletion']] as const) {
    const result = getPlatformHelp(topic);
    assert.equal(result.source, platformPolicies[key]);
    assert.ok('sections' in result.source);
    assert.ok(result.source.sections.length > 0);
    assert.match(result.rules, /never invent a policy/i);
  }
  for (const topic of platformHelpTopics) assert.ok(getPlatformHelp(topic).source, topic);
});

test('both prompt layers enforce manual choice, sourced help, removed roles and human-only sensitive actions', () => {
  for (const prompt of [systemPrompt, marketplaceSystemInstructions]) {
    assert.match(prompt, /unpublished.*draft/i);
    assert.match(prompt, /manual creation|الإنشاء اليدوي/);
    assert.match(prompt, /getPlatformHelp/);
    assert.match(prompt, /comparison|compare/);
    assert.match(prompt, /unavailable|removed|Do not search/);
    assert.match(prompt, /\/account\/listings/);
    assert.match(prompt, /multiple_distinct_products_in_images/);
    assert.doesNotMatch(prompt, /Use searchMarketplaceListings|Use compareMarketplaceListings|Use estimateListingPrice|Use evaluateNegotiationOffer/);
  }
  const rendered = renderPlatformCapabilitiesForPrompt();
  assert.match(rendered, /Sensitive actions are user-interface-only/);
  assert.match(rendered, /Do not invent/);
  assert.doesNotMatch(rendered, /tools=(?:searchMarketplaceListings|compareMarketplaceListings|estimateListingPrice|evaluateNegotiationOffer)/);
});
