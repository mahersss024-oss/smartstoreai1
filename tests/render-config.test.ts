import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const renderConfig = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');

test('render deploys the production branch after commit checks', () => {
  assert.match(renderConfig, /^\s+name: smartstore-ai-marketplace$/m);
  assert.match(renderConfig, /^\s+plan: 1c-2g$/m);
  assert.match(renderConfig, /^\s+region: frankfurt$/m);
  assert.match(renderConfig, /^\s+branch: production$/m);
  assert.match(renderConfig, /^\s+autoDeployTrigger: checksPass$/m);
  assert.match(renderConfig, /domains:\s+- souqhamad\.com/);
  assert.match(renderConfig, /^\s+healthCheckPath: \/api\/health$/m);
});

test('render loads the production configuration before starting the server', () => {
  assert.match(renderConfig, /node -e "Object\.assign\(process\.env,require\('\/etc\/secrets\/production\.json'\)\); import\('\.\/scripts\/start\.mjs'\)"/);
  assert.match(renderConfig, /key: SMARTSTORE_MARKETPLACE_STORE\s+value: database/);
  assert.doesNotMatch(renderConfig, /^\s+preDeployCommand:/m);
});

test('render installs with pinned pnpm and includes build dependencies', () => {
  assert.match(renderConfig, /corepack prepare pnpm@10\.32\.1 --activate &&\s+corepack pnpm install --frozen-lockfile --prod=false &&\s+corepack pnpm build/);
});

test('render pins the production Node major version', () => {
  assert.match(renderConfig, /key: NODE_VERSION\s+value: "24"/);
});
