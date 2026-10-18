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

test('system prompt identifies the assistant as Hamad for identity questions', () => {
  assert.match(systemPrompt, /You are Hamad/);
  assert.match(systemPrompt, /أنا حمد، مساعدك في سوق حمد/);
  assert.match(systemPrompt, /create listings and search marketplace listings/);
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
  assert.match(systemPrompt, /Buyer-seller chat allows direct contact details/);
  assert.match(systemPrompt, /users own responsibility/);
  assert.match(systemPrompt, /Do not claim to see hidden UI state, click buttons, navigate pages/);
  assert.match(systemPrompt, /The assistant only sees and acts through explicit platform capabilities/);
  assert.match(systemPrompt, /Do not invent listings, sellers, prices/);
  assert.match(systemPrompt, /does not process, hold, transfer, guarantee, or mediate buyer-seller payment money/);
  assert.match(systemPrompt, /fraud risk/);
  assert.match(systemPrompt, /call the search tool first/);
  assert.match(systemPrompt, /after visible matches exist/);
});

test('system prompt makes photos optional with advisory inspection and authoritative human moderation', () => {
  assert.match(systemPrompt, /Images are optional/);
  assert.match(systemPrompt, /Server image inspection is advisory and can generate administration review alerts, never an automatic rejection/);
  assert.match(systemPrompt, /Human moderation and technical security checks remain enforced/);
  assert.match(systemPrompt, /Never provide operational instructions for wrongdoing or bypass human moderation or technical permissions/);
  assert.match(systemPrompt, /image inspection is unavailable/);
  assert.match(systemPrompt, /Different standalone products must not be merged into one listing/);
  assert.match(systemPrompt, /multiple_distinct_products_in_images/);
  assert.match(systemPrompt, /one bundled listing or separate listings/);
});
