import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

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
