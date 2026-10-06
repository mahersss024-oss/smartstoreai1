import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractAssistantSearchToolResults,
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

test('chat route streams marketplace tool outputs with guarded text responses', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );

  assert.match(route, /extractAssistantSearchToolResults\(firstResult\)/);
  assert.match(route, /extractAssistantSearchToolResults\(retryResult\)/);
  assert.match(route, /type: 'tool-input-available'/);
  assert.match(route, /type: 'tool-output-available'/);
});

test('chat route keeps buyer search responses on the real agent path', () => {
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

test('chat route inspects all uploaded images before assistant reasoning', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );
  const chatVisionReview = route.slice(
    route.indexOf('imageComplianceDecision = await checkImageMarketplaceCompliance({'),
    route.indexOf('if (imageComplianceDecision.decision ==='),
  );

  assert.match(chatVisionReview, /reviewMode: 'all_images'/);
  assert.doesNotMatch(chatVisionReview, /reviewMode: 'primary_only'/);
});
