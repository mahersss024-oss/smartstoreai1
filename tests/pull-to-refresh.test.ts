import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('pull to refresh is touch scoped and avoids global touch blocking', () => {
  const source = readProjectFile('components', 'pull-to-refresh.tsx');

  assert.match(source, /pointer: coarse/);
  assert.match(source, /window\.scrollY > 0/);
  assert.match(source, /smartstore-ai-bubble/);
  assert.match(source, /input/);
  assert.match(source, /textarea/);
  assert.match(source, /select/);
  assert.match(source, /smartstore:pull-refresh/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /isNativeAppRuntime/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /SouqHamadCapacitor/);
  assert.doesNotMatch(source, /preventDefault\(/);
});

test('main client data pages subscribe to pull refresh events', () => {
  const files = [
    ['app', 'page.tsx'],
    ['app', 'account', 'listings', 'page.tsx'],
    ['app', 'conversations', 'page.tsx'],
    ['app', 'conversations', '[conversationId]', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'commissions', 'page.tsx'],
  ];

  for (const file of files) {
    const source = readProjectFile(...file);

    assert.match(source, /smartstore:pull-refresh/, file.join('/'));
    assert.match(source, /addEventListener/, file.join('/'));
    assert.match(source, /removeEventListener/, file.join('/'));
  }
});

test('root layout mounts pull to refresh without duplicating viewport meta', () => {
  const source = readProjectFile('app', 'layout.tsx');

  assert.match(source, /maximumScale: 1/);
  assert.match(source, /userScalable: false/);
  assert.match(source, /<PullToRefresh \/>/);
  assert.doesNotMatch(source, /<meta[^>]+viewport/);
});
