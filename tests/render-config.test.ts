import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const renderConfig = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');

test('render starts the web server without blocking port binding on migrations', () => {
  assert.match(renderConfig, /preDeployCommand: .*pnpm db:deploy/);
  assert.match(renderConfig, /startCommand: node scripts\/start\.mjs/);
  assert.doesNotMatch(renderConfig, /startCommand: .*db:deploy/);
  assert.doesNotMatch(renderConfig, /startCommand: .*pnpm start/);
});

test('render pins pnpm before install and pre-deploy commands', () => {
  const pinnedPnpm = /corepack prepare pnpm@10\.32\.1 --activate/g;

  assert.equal([...renderConfig.matchAll(pinnedPnpm)].length, 2);
});
