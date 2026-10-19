import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createMarketplaceTools } from '@/agent/tools/marketplace';

test('retired chat search, result adapters, keyword matching and unused cache files are absent', () => {
  for (const file of [
    'lib/chat-tool-results.ts',
    'lib/chat-listing-display.ts',
    'lib/chat/search-owner.ts',
    'lib/api/memory-json-cache.ts',
    'agent/marketplace/adaptive-intent.ts',
    'agent/marketplace/arabic-word-match.ts',
    'agent/marketplace/search-engine.ts',
    'agent/marketplace/retrieval-engine.ts',
    'agent/marketplace/search-state.ts',
    'agent/marketplace/search-understanding.ts',
    'agent/marketplace/search-understanding-schema.ts',
  ]) assert.equal(existsSync(file), false, file);
});

test('removed search continuation, notifications and visual styles cannot return unnoticed', () => {
  assert.doesNotMatch(readFileSync('agent/scope-guard.ts', 'utf8'), /getMarketplaceContinuationScopeDecision|model_marketplace_follow_up/);
  assert.doesNotMatch(readFileSync('lib/chat/conversation.ts', 'utf8'), /scopeChatSearchOwnerKey/);
  assert.doesNotMatch(readFileSync('lib/realtime/events.ts', 'utf8'), /ai_results_updated/);
  assert.doesNotMatch(readFileSync('app/globals.css', 'utf8'), /smart-assistant-results-panel|smart-assistant-result-card/);
});

test('Hamad keeps only the documented help and unpublished draft tools after cleanup', () => {
  assert.deepEqual(Object.keys(createMarketplaceTools(null)).sort(), [
    'addUploadedImagesToListing', 'analyzeListingImages', 'createListingDraft', 'getPlatformHelp', 'updateListing',
  ]);
});
