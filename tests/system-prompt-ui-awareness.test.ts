import assert from 'node:assert/strict';
import test from 'node:test';

import { systemPrompt } from '@/agent/system-prompt';

test('system prompt knows assistant search can be cleared without changing model behavior', () => {
  assert.match(systemPrompt, /active search area/);
  assert.match(systemPrompt, /clears the assistant search effect/);
  assert.match(systemPrompt, /without deleting the chat/);
  assert.match(systemPrompt, /Do not mention this UI control unless the user asks/);
  assert.doesNotMatch(systemPrompt, /always mention this UI control/i);
});
