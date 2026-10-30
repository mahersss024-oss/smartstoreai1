import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('market listing indicator uses the megaphone icon instead of the store glyph', () => {
  const files = [
    readProjectFile('app', 'admin', 'page.tsx'),
    readProjectFile('app', 'admin', 'listings', 'page.tsx'),
    readProjectFile('app', 'admin', 'users', 'page.tsx'),
  ];

  for (const source of files) {
    assert.match(source, /Megaphone/);
    assert.doesNotMatch(source, /\bStore\b/);
    assert.doesNotMatch(source, /<Store/);
  }

  const favoritesPage = readProjectFile('app', 'favorites', 'page.tsx');
  assert.match(favoritesPage, /CustomerAppGateway/);
  assert.doesNotMatch(favoritesPage, /\bStore\b/);
  assert.doesNotMatch(favoritesPage, /<Store/);
});
