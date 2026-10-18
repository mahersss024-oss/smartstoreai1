import assert from 'node:assert/strict';
import test from 'node:test';

import {
  platformCapabilities,
  renderPlatformCapabilitiesForPrompt,
} from '@/agent/platform-capabilities';
import { marketplaceSystemInstructions } from '@/agent/marketplace/agents';
import { systemPrompt } from '@/agent/system-prompt';
import { createMarketplaceTools } from '@/agent/tools/marketplace';

test('platform capabilities define what chat can do and what requires confirmation', () => {
  const byAction = new Map(
    platformCapabilities.map((capability) => [capability.action, capability]),
  );

  assert.equal(byAction.get('search_listings')?.allowedTools.includes('searchMarketplaceListings'), true);
  assert.equal(byAction.get('create_listing_draft')?.requiresAuth, true);
  assert.equal(byAction.get('create_listing_draft')?.requiresConfirmation, false);
  assert.equal(byAction.get('publish_or_status_change')?.requiresConfirmation, true);
  assert.match(
    byAction.get('publish_or_status_change')?.canDo ?? '',
    /cannot publish listings/,
  );
  assert.match(
    byAction.get('publish_or_status_change')?.userGuidance ?? '',
    /press the publish button themselves/,
  );
  assert.deepEqual(byAction.get('open_conversation')?.allowedTools, []);
  assert.match(
    byAction.get('open_conversation')?.userGuidance ?? '',
    /Never open a buyer-seller conversation from chat/,
  );
  assert.equal(byAction.get('reports')?.requiresConfirmation, true);
  for (const action of ['publish_or_status_change', 'open_conversation', 'favorites', 'reports']) {
    assert.deepEqual(byAction.get(action)?.allowedTools, [], action);
  }
  const actualTools = Object.keys(createMarketplaceTools(null)).sort();
  const describedTools = [...new Set(platformCapabilities.flatMap(capability => capability.allowedTools))].sort();
  assert.deepEqual(describedTools, actualTools);
  assert.equal(byAction.get('platform_help')?.allowedTools.length, 0);
});

test('chat prompts use the centralized platform capability map', () => {
  const renderedCapabilities = renderPlatformCapabilitiesForPrompt();

  assert.match(renderedCapabilities, /Platform capability rules/);
  assert.match(renderedCapabilities, /\/account/);
  assert.match(renderedCapabilities, /\/conversations/);
  assert.match(renderedCapabilities, /Buyer-seller chat allows direct contact details/);
  assert.match(renderedCapabilities, /users own responsibility/);
  assert.match(renderedCapabilities, /Sharing a public listing link is allowed/);
  assert.match(renderedCapabilities, /real listingUrl is available/);
  assert.match(renderedCapabilities, /requires_confirmation=yes/);
  assert.match(renderedCapabilities, /searchMarketplaceListings/);
  assert.match(renderedCapabilities, /structured/);
  assert.match(renderedCapabilities, /createListingDraft/);
  assert.match(renderedCapabilities, /Assistant chat cannot publish listings/);
  assert.match(renderedCapabilities, /The assistant only sees and acts through explicit platform capabilities/);
  assert.match(renderedCapabilities, /not an escrow service, payment processor, money-transfer intermediary, or guarantor/);
  assert.match(renderedCapabilities, /fraud risk/);
  assert.match(renderedCapabilities, /Never open a buyer-seller conversation from chat/);
  assert.doesNotMatch(renderedCapabilities, /openMarketplaceConversation/);
  assert.match(systemPrompt, /Available platform capabilities/);
  assert.match(marketplaceSystemInstructions, /Available platform capabilities/);
  assert.match(marketplaceSystemInstructions, /share the listingUrl/);
  assert.match(marketplaceSystemInstructions, /Be creative where it is safe/);
  assert.match(marketplaceSystemInstructions, /Be strict where facts affect the real marketplace/);
  assert.match(marketplaceSystemInstructions, /Treat marketplace tool outputs as the source of truth/);
  assert.match(marketplaceSystemInstructions, /instead of inventing a successful result/);
  assert.match(marketplaceSystemInstructions, /confirmation flag such as confirmed or confirmedPriceChange/);
  assert.match(marketplaceSystemInstructions, /multiple_distinct_products_in_images/);
  assert.match(marketplaceSystemInstructions, /one bundled listing or separate listings/);
  assert.doesNotMatch(marketplaceSystemInstructions, /Use openMarketplaceConversation/);
});
