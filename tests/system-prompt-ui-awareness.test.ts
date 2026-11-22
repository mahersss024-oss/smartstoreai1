import assert from 'node:assert/strict';
import test from 'node:test';
import { hamadPlanInstructions, hamadReplyInstructions } from '@/lib/chat/hamad-structured-model';

test('Hamad asks for the creation method and matches the draft through the displayed options', () => {
  assert.match(hamadPlanInstructions, /owned unpublished drafts and documented Souq Hamad help/);
  assert.match(hamadPlanInstructions, /الإنشاء مع حمد/);
  assert.match(hamadPlanInstructions, /الإنشاء اليدوي/);
  assert.match(hamadPlanInstructions, /show the customer their available drafts for selection/);
  assert.match(hamadPlanInstructions, /Never guess an ID/);
});

test('Hamad uses confirmed details and documented facts, with advisory-only review', () => {
  assert.match(hamadPlanInstructions, /Omit unknown\/null details; preserve unchanged values/);
  assert.match(hamadPlanInstructions, /Photos and optional specifications may be added later/);
  assert.match(hamadPlanInstructions, /one bundle or separate drafts/);
  assert.match(hamadPlanInstructions, /advises administrators only/);
  assert.match(hamadReplyInstructions, /Use only the given trusted server facts/);
  assert.match(hamadReplyInstructions, /Do not claim anything was published/);
  assert.match(hamadReplyInstructions, /exact public source/);
});
