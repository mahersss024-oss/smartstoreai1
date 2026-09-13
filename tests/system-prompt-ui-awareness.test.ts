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

test('system prompt guides signed-in users through platform account help safely', () => {
  assert.match(systemPrompt, /Google or Apple sign-in/);
  assert.match(systemPrompt, /platform_help/);
  assert.match(systemPrompt, /\/account/);
  assert.match(systemPrompt, /saved contact phone/);
  assert.match(systemPrompt, /\/conversations/);
  assert.match(systemPrompt, /\/commissions/);
  assert.match(systemPrompt, /\/commission-policy/);
  assert.match(systemPrompt, /\/listing-policy/);
  assert.match(systemPrompt, /\/terms/);
  assert.match(systemPrompt, /\/privacy/);
  assert.match(systemPrompt, /Manual phone numbers and emails are blocked/);
  assert.match(systemPrompt, /Do not claim to see hidden UI state, click buttons, navigate pages/);
  assert.match(systemPrompt, /The assistant only sees and acts through explicit platform capabilities/);
  assert.match(systemPrompt, /Do not invent listings, sellers, prices/);
});
