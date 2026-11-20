import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('chat route reviews all draft and help tool steps but never streams old search outputs', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );

  const engine = readFileSync(join(process.cwd(), 'lib', 'chat', 'hamad-engine.ts'), 'utf8');
  assert.match(route, /await runHamadTurn\(turn\)/);
  assert.match(engine, /firstResult\.steps\.flatMap\(step => step\.toolResults\)/);
  assert.match(engine, /assistantResponse: firstText, verifiedToolResults/);
  assert.doesNotMatch(route + engine, /extractAssistantSearchToolResults|type: 'tool-input-available'|type: 'tool-output-available'/);
});

test('chat route has no buyer search fast path and keeps bounded model generation', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
    'utf8',
  );

  const engine = readFileSync(join(process.cwd(), 'lib', 'chat', 'hamad-engine.ts'), 'utf8');
  assert.doesNotMatch(route + engine, /direct_search_fast_path|maybeCreateDirectSearchResponse|isGenericMarketplaceSearchStarter|getGenericMarketplaceSearchStarterResponse/);
  assert.match(engine, /createChatAgent\(session/);
  assert.match(engine, /generate\(startAgent\(\), generationTimeoutMs\)/);
  assert.match(engine, /abortSignal: AbortSignal\.any\(\[signal, abortSignal\]\)/);
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
