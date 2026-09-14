import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('home assistant starts clean without durable chat history', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /resetAssistantSearchState/);
  assert.match(homePage, /resetSearchState/);
  assert.match(homePage, /shouldResetSearchStateRef\.current = true/);
  assert.doesNotMatch(
    homePage,
    /localStorage\.setItem\(\s*currentChatStorageKey/,
  );
});

test('home assistant keeps chat only across in-app navigation', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /type HomeAssistantRuntimeState/);
  assert.match(homePage, /readHomeAssistantRuntimeState/);
  assert.match(homePage, /writeHomeAssistantRuntimeState/);
  assert.match(homePage, /clearHomeAssistantRuntimeState/);
  assert.match(homePage, /setMessages\(restoredChatState\.messages\)/);
  assert.match(homePage, /setActiveListingQuery\(restoredChatState\.activeListingQuery\)/);
  assert.match(homePage, /clearHomeAssistantRuntimeState\(\)/);
  assert.doesNotMatch(homePage, /sessionStorage\.setItem\(\s*currentChatStorageKey/);
});

test('home assistant starter search is generic instead of a fixed car city example', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /'أبحث عن منتج'/);
  assert.doesNotMatch(homePage, /'أبحث عن سيارة في الرياض'/);
});
