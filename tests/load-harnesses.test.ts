import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

function runAiLoad(overrides: Record<string, string> = {}) {
  return run(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/ai-path-load-test.ts')], {
    timeout: 30_000,
    env: {
      ...process.env,
      CI: '1', DEEPSEEK_API_KEY: 'test-model-placeholder', AUTH_SECRET: 'local-load-regression-only-auth-secret',
      DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/isolated?connect_timeout=1',
      SMARTSTORE_MARKETPLACE_STORE: 'file', AI_LOAD_MODE: 'mock', AI_LOAD_LEVELS: '1,2',
      AI_LOAD_PROVIDER_LATENCY_MS: '0', AI_LOAD_REQUEST_TIMEOUT_MS: '10000',
      AI_LOAD_PROVIDER_STATUS: '200', AI_LOAD_PROVIDER_MAX_IN_FLIGHT: '0',
      ...overrides,
    },
  });
}

test('AI load checks exercise documented platform help through the real route and provider adapter', async () => {
  const { stdout } = await runAiLoad();
  const levels = stdout.split(/\r?\n/).filter(line => line.startsWith('{"level":')).map(line => JSON.parse(line));
  assert.deepEqual(levels.map(level => level.level), [1, 2]);
  for (const level of levels) {
    assert.equal(level.ok, level.total);
    assert.equal(level.failed, 0);
    assert.equal(level.incompleteStreams, 0);
    assert.ok(level.providerCalls >= level.total * 2);
    assert.equal(level.providerRejectedCalls, 0);
  }
  const source = readFileSync(resolve('scripts/testing/platform-help-model-fixture.mjs'), 'utf8');
  assert.match(source, /getPlatformHelp/);
  assert.doesNotMatch(source, /load_test_search|adaptive intent router|وجدت لك نتائج مناسبة|أبحث عن كامري/);
  assert.match(readFileSync(resolve('scripts/ai-path-load-test.ts'), 'utf8'), /performance\.now\(\) - start > requestTimeoutMs/);
});

for (const [ci, key, mode, expected] of [
  ['1', 'test-model-placeholder', 'platform-help', 200],
  ['0', 'test-model-placeholder', 'platform-help', 401],
  ['1', 'not-a-real-key', 'platform-help', 401],
  ['1', 'test-model-placeholder', '', 401],
] as const) {
  test(`isolated model fixture is opt-in: ci=${ci}, placeholder=${key === 'test-model-placeholder'}, fixture=${mode || 'disabled'}`, async () => {
    const { stdout } = await run(process.execPath, ['--import', pathToFileURL(resolve('scripts/testing/isolated-model-provider.mjs')).href, '-e',
      `fetch('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [], tools: [{ function: { name: 'getPlatformHelp' } }] }) }).then(async response => console.log(JSON.stringify({ status: response.status, body: await response.json() })));`], {
      timeout: 10_000,
      env: { ...process.env, CI: ci, DEEPSEEK_API_KEY: key, SMARTSTORE_TEST_MODEL_FIXTURE: mode },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.status, expected);
    if (expected === 200) assert.equal(result.body.choices[0].message.tool_calls[0].function.name, 'getPlatformHelp');
  });
}

test('AI load timeouts are failures rather than successful process exits', async () => {
  await assert.rejects(runAiLoad({ AI_LOAD_LEVELS: '1', AI_LOAD_REQUEST_TIMEOUT_MS: '1', AI_LOAD_PROVIDER_LATENCY_MS: '50' }),
    (error: Error & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? '', /"failed":1/);
      return true;
    });
});

test('AI load counts a completed HTTP 200 provider-failure reply as a failure', async () => {
  await assert.rejects(runAiLoad({ AI_LOAD_LEVELS: '1,2', AI_LOAD_PROVIDER_STATUS: '401' }),
    (error: Error & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 1);
      const levels = (error.stdout ?? '').split(/\r?\n/).filter(line => line.startsWith('{"level":'));
      assert.equal(levels.length, 1, 'a failed level must stop escalation');
      const result = JSON.parse(levels[0]);
      assert.equal(result.httpErrors, 0);
      assert.equal(result.incompleteStreams, 0);
      assert.equal(result.providerFallbackResponses, 1);
      assert.equal(result.failed, 1);
      assert.equal(result.ok, 0);
      return true;
    });
});

test('AI load rejects an empty valid level set instead of silently succeeding', async () => {
  await assert.rejects(runAiLoad({ AI_LOAD_LEVELS: 'invalid,0,-1' }),
    (error: Error & { code?: number; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr ?? '', /AI_LOAD_LEVELS/);
      return true;
    });
});

test('browser load checks use observed vitals and distinct reports without waiting for a realtime connection to idle', () => {
  const source = readFileSync(resolve('tests/load/browser/page-flow.spec.ts'), 'utf8');
  const config = readFileSync(resolve('tests/load/browser/playwright.config.ts'), 'utf8');
  assert.match(config, /outputDir: '\.\.\/\.\.\/\.\.\/coverage\/browser-load-artifacts'/);
  assert.match(source, /observePageVitals\(page\)/);
  assert.match(source, /readPageVitals\(page\)/);
  assert.match(source, /browser-page-flow-\$\{testInfo\.project\.name\}/);
  assert.doesNotMatch(source, /getEntriesByType\('(?:largest-contentful-paint|layout-shift)'\)|waitForLoadState\('networkidle'/);
});

test('HTTP load scenarios use current read-only help and a valid manual draft contract', () => {
  const chat = readFileSync(resolve('tests/load/api/chat-read.js'), 'utf8');
  const write = readFileSync(resolve('tests/load/api/write-smoke.js'), 'utf8');
  assert.match(chat, /documented platform help/);
  assert.match(chat, /chat reply completes/);
  assert.match(chat, /chat provider is available/);
  assert.doesNotMatch(chat, /ابحث عن سيارة/);
  assert.match(write, /category: 'other'/);
  assert.match(write, /write smoke creates an unpublished draft/);
  assert.doesNotMatch(write, /category: 'load-test'|condition: 'used'/);
});

for (const separator of [[], ['--']]) {
  test(`k6 runner preserves command flags ${separator.length ? 'with' : 'without'} an explicit separator`, async () => {
    const flags = ['--vus', '1', '--iterations', '1', '--duration', '10s', '--quiet'];
    const { stdout } = await run(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/k6-spawn-probe.mjs')).href,
      resolve('tests/load/scripts/run-k6.mjs'), 'tests/load/scenarios/public-read.js', ...separator, ...flags]);
    const invocation = JSON.parse(stdout);
    assert.equal(invocation.command, 'k6');
    assert.deepEqual(invocation.args, ['run', resolve('tests/load/scenarios/public-read.js'), ...flags]);
  });
}

test('stress stages never exceed the configured maximum number of virtual users', () => {
  const source = readFileSync(resolve('tests/load/scenarios/stress.js'), 'utf8');
  for (const target of [50, 100, 250, 500]) assert.ok(source.includes(`target: Math.min(loadEnv.maxVus, ${target})`));
  assert.doesNotMatch(source, /target: (?:50|100|250|500)\s*[,}]/);
});

test('image load checks require image samples, reject non-image responses and never send session cookies to image hosts', () => {
  const source = readFileSync(resolve('tests/load/images/image-flow.js'), 'utf8');
  const helpers = readFileSync(resolve('tests/load/helpers/http.js'), 'utf8');
  assert.match(source, /checks: \['rate==1'\]/);
  assert.match(source, /'image sample is not empty': count => count > 0/);
  assert.match(helpers, /includeSession && loadEnv.sessionCookie/);
  assert.match(helpers, /headers\(\{ accept: 'image\/avif,image\/webp,image\/\*,\*\/\*;q=0\.8' \}, false\)/);
  assert.match(helpers, /imageErrors\.add\(!validImage/);
  assert.match(helpers, /res\.status >= 200 && res\.status < 400/g);
});
