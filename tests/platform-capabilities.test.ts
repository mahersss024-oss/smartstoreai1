import assert from 'node:assert/strict';
import test from 'node:test';

import {
  platformCapabilities,
  renderPlatformCapabilitiesForPrompt,
} from '@/agent/platform-capabilities';
import { marketplaceSystemInstructions } from '@/agent/marketplace/agents';
import { systemPrompt } from '@/agent/system-prompt';

test('platform capabilities define what chat can do and what requires confirmation', () => {
  const byAction = new Map(
    platformCapabilities.map((capability) => [capability.action, capability]),
  );

  assert.equal(byAction.get('search_listings')?.allowedTools.includes('searchMarketplaceListings'), true);
  assert.equal(byAction.get('create_listing_draft')?.requiresAuth, true);
  assert.equal(byAction.get('create_listing_draft')?.requiresConfirmation, false);
  assert.equal(byAction.get('publish_or_status_change')?.requiresConfirmation, true);
  assert.equal(byAction.get('reports')?.requiresConfirmation, true);
  assert.equal(byAction.get('platform_help')?.allowedTools.length, 0);
});

test('chat prompts use the centralized platform capability map', () => {
  const renderedCapabilities = renderPlatformCapabilitiesForPrompt();

  assert.match(renderedCapabilities, /Platform capability rules/);
  assert.match(renderedCapabilities, /\/account/);
  assert.match(renderedCapabilities, /\/conversations/);
  assert.match(renderedCapabilities, /manual phone numbers and emails are blocked/i);
  assert.match(renderedCapabilities, /requires_confirmation=yes/);
  assert.match(renderedCapabilities, /searchMarketplaceListings/);
  assert.match(renderedCapabilities, /createListingDraft/);
  assert.match(renderedCapabilities, /The assistant only sees and acts through explicit platform capabilities/);
  assert.match(systemPrompt, /Available platform capabilities/);
  assert.match(marketplaceSystemInstructions, /Available platform capabilities/);
});
