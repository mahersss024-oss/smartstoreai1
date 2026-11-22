import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hamadCapabilities } from '@/lib/chat/hamad-capabilities';

test('chat uses a single structured entry point and streams only verified text, previews and metadata', () => {
  const route = readFileSync('app/api/chat/route.ts', 'utf8');
  assert.match(route, /runStructuredHamadTurn\(\{/);
  assert.doesNotMatch(route, /SMARTSTORE_HAMAD_STRUCTURED|runHamadTurn|tool-input-available|tool-output-available/);
  const model = readFileSync('lib/chat/hamad-structured-model.ts', 'utf8');
  const turn = readFileSync('lib/chat/hamad-structured-turn.ts', 'utf8');
  assert.match(model, /maxRetries: 0/);
  assert.match(turn, /AbortSignal\.timeout\(55_000\)/);
  assert.match(turn, /await verifyHamadReply/);
  assert.deepEqual(Object.keys(hamadCapabilities).sort(), ['analyze_image', 'attach_draft_images', 'create_draft',
    'get_categories', 'get_draft', 'get_platform_info', 'list_my_drafts', 'update_draft']);
});
