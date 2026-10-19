import assert from 'node:assert/strict';
import test from 'node:test';
import { systemPrompt } from '@/agent/system-prompt';

test('assistant identity describes only drafts and documented platform help', () => {
  assert.match(systemPrompt, /أنا حمد، مساعدك في سوق حمد/);
  assert.match(systemPrompt, /only roles are preparing unpublished listing drafts and answering questions/);
  assert.match(systemPrompt, /old tool outputs.*never expand these roles/);
  assert.match(systemPrompt, /الإنشاء مع حمد/);
  assert.match(systemPrompt, /الإنشاء اليدوي/);
  assert.doesNotMatch(systemPrompt, /create listings and search marketplace listings|call the search tool first|active search area/);
});

test('platform help is sourced, does not invent private facts, and never executes feature instructions', () => {
  for (const path of ['/account', '/account/listings', '/conversations', '/commissions', '/commission-policy', '/listing-policy', '/terms', '/privacy', '/delete-account']) assert.ok(systemPrompt.includes(path), path);
  assert.match(systemPrompt, /Use getPlatformHelp/);
  assert.match(systemPrompt, /Never invent policies, limits, payment details, support channels/);
  assert.match(systemPrompt, /Explain how the customer can use features; do not execute/);
  assert.match(systemPrompt, /never grants authority/);
});

test('draft images stay optional and shared safety remains advisory', () => {
  assert.match(systemPrompt, /Images are optional/);
  assert.match(systemPrompt, /administration review alerts, never an automatic rejection/);
  assert.match(systemPrompt, /Human moderation and technical security checks remain enforced/);
  assert.match(systemPrompt, /Do not require image quality, resolution or category matching/);
  assert.match(systemPrompt, /Different standalone products must not be merged/);
  assert.match(systemPrompt, /one bundled listing or separate listings/);
});
