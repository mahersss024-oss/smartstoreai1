import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractAssistantSearchToolResults,
  selectAssistantSearchToolResults,
  isAssistantSearchToolOutput,
} from '@/lib/chat-tool-results';

test('recognizes assistant marketplace search outputs', () => {
  assert.equal(
    isAssistantSearchToolOutput({
      status: 'searched',
      listings: [{ id: 'listing-1' }],
    }),
    true,
  );
  assert.equal(
    isAssistantSearchToolOutput({
      status: 'drafted',
      listings: [{ id: 'listing-1' }],
    }),
    false,
  );
});

test('extracts only display-safe marketplace search and comparison tool results', () => {
  const results = extractAssistantSearchToolResults({
    staticToolResults: [
      {
        toolCallId: 'search-1',
        toolName: 'searchMarketplaceListings',
        input: { query: 'نيسان باترول 2025' },
        output: {
          status: 'searched',
          listings: [{ id: 'patrol-2025' }],
        },
      },
      {
        toolCallId: 'draft-1',
        toolName: 'createListingDraft',
        input: { title: 'hidden draft' },
        output: {
          status: 'drafted',
          draft: { id: 'draft-1' },
        },
      },
    ],
    toolResults: [
      {
        toolCallId: 'compare-1',
        toolName: 'compareMarketplaceListings',
        input: { listingIds: ['patrol-2025'] },
        output: {
          status: 'compared',
          listings: [{ id: 'patrol-2025' }],
        },
      },
      {
        toolCallId: 'search-1',
        toolName: 'searchMarketplaceListings',
        input: { query: 'duplicate' },
        output: {
          status: 'searched',
          listings: [{ id: 'duplicate' }],
        },
      },
    ],
  });

  assert.deepEqual(results, [
    {
      toolCallId: 'search-1',
      toolName: 'searchMarketplaceListings',
      input: { query: 'نيسان باترول 2025' },
      output: {
        status: 'searched',
        listings: [{ id: 'patrol-2025' }],
      },
    },
    {
      toolCallId: 'compare-1',
      toolName: 'compareMarketplaceListings',
      input: { listingIds: ['patrol-2025'] },
      output: {
        status: 'compared',
        listings: [{ id: 'patrol-2025' }],
      },
    },
  ]);
});

test('retry preserves verified matches and respects an explicitly empty newer result', () => {
  const first = [{ toolCallId: 'a', toolName: 'searchMarketplaceListings' as const, input: {}, output: { status: 'searched' as const, listings: [{ id: 'verified' }] } }];
  assert.deepEqual(selectAssistantSearchToolResults(first, []), first);
  const empty = [{ ...first[0], toolCallId: 'b', output: { status: 'searched' as const, listings: [] } }];
  assert.deepEqual(selectAssistantSearchToolResults(first, empty), empty);
});

test('chat route reviews all draft and help tool steps but never streams old search outputs', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );

  assert.match(route, /firstResult\.steps\.flatMap\(step => step\.toolResults\)/);
  assert.match(route, /assistantResponse: firstText, verifiedToolResults/);
  assert.doesNotMatch(route, /extractAssistantSearchToolResults|type: 'tool-input-available'|type: 'tool-output-available'/);
});

test('chat route has no buyer search fast path and keeps bounded model generation', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );

  assert.doesNotMatch(route, /direct_search_fast_path/);
  assert.doesNotMatch(route, /maybeCreateDirectSearchResponse/);
  assert.doesNotMatch(route, /isGenericMarketplaceSearchStarter/);
  assert.doesNotMatch(route, /getGenericMarketplaceSearchStarterResponse/);
  assert.match(route, /createChatAgent\(session/);
  assert.match(route, /chatAgentGenerationTimeoutMs/);
  assert.match(route, /abortSignal: signal/);
});

test('chat image assessments are advisory and do not block uploads or publication', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );
  const chatVisionReview = route.slice(
    route.indexOf('imageComplianceDecision = (await reviewListingImageContent('),
    route.indexOf('  const authSystemMessage =', route.indexOf('imageComplianceDecision = (await reviewListingImageContent(')),
  );

  assert.match(chatVisionReview, /reviewListingImageContent\(latestUploadedImages\)/);
  assert.doesNotMatch(chatVisionReview, /reviewMode: 'primary_only'/);
  assert.doesNotMatch(chatVisionReview, /kind: 'image_policy_block'/);
  assert.match(chatVisionReview, /await recordModelReview/);
  assert.doesNotMatch(chatVisionReview, /kind: 'image_inspection_unavailable'/);
  assert.match(chatVisionReview, /Do not claim that the images were checked/);
  assert.doesNotMatch(chatVisionReview, /kind: 'image_manual_review'/);
  const context = route.slice(route.indexOf('function createImageComplianceContextMessage('),
    route.indexOf('function addDefaultTextToLatestImageOnlyMessage('));
  assert.doesNotMatch(context, /decision: decision.decision|reasons: decision.reasons|categoryMatch: decision.categoryMatch/);
});
