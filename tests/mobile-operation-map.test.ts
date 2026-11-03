import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { routeShape, scenarioEvidence, serverContextHash, sourceContextHash, sourceHash, testTitles } from '@/scripts/testing/mobile-operation-map';
import type { MobileScenario } from '@/scripts/testing/mobile-operation-types';

test('mobile operation route matching keeps static segments and ignores dynamic parameter names and queries', () => {
  assert.equal(routeShape('/api/listings/[listingId]/images/[imageId]?view=one'), routeShape('/api/listings/[param]/images/[param]'));
  assert.notEqual(routeShape('/api/listings/[param]/images'), routeShape('/api/listings/[param]/image-uploads'));
  assert.notEqual(routeShape('/api/listings/[param]'), routeShape('/api/listings/[param]/similar'));
});

test('mobile operation evidence requires the named test, matching source and context instead of an aggregate pass', t => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-contract-evidence-'));
  t.after(() => {
    assert.ok(root.startsWith(join(tmpdir(), 'mobile-contract-evidence-')));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'tests'));
  const file = 'tests/fixture.test.ts';
  const full = join(root, file);
  writeFileSync(full, "test('a real scenario', () => assert.ok(true));\n");
  const scenario: MobileScenario = { file, testTitle: 'a real scenario', verifies: ['fixture'], mode: 'node' };
  const event = { file, name: scenario.testTitle, sourceHash: sourceHash(full), status: 'passed' };
  const receipt = { contextHash: 'current-context', createdAt: 'fixture-run', summary: { passed: 100 }, tests: [event] };
  assert.equal(scenarioEvidence(root, root, scenario, 'current-context', receipt).result, 'passed');
  assert.equal(scenarioEvidence(root, root, scenario, 'changed-context', receipt).result, 'stale-result');
  assert.equal(scenarioEvidence(root, root, scenario, 'current-context', { ...receipt, tests: [] }).result, 'not-run');
  assert.equal(scenarioEvidence(root, root, scenario, 'current-context', { ...receipt, tests: [{ ...event, status: 'skipped' }] }).result, 'skipped');
  assert.equal(scenarioEvidence(root, root, scenario, 'current-context', { ...receipt, tests: [event, { ...event, status: 'failed' }] }).result, 'failed');
  writeFileSync(full, "test('a real scenario', () => assert.equal(actual, expected));\n");
  assert.equal(scenarioEvidence(root, root, scenario, 'current-context', receipt).result, 'stale-result');
  assert.equal(scenarioEvidence(root, root, { ...scenario, testTitle: 'absent scenario' }, 'current-context', receipt).valid, false);
});

test('mobile operation title and source checks reject comments and detect changed business source', t => {
  const titles = testTitles('tests/sample.test.ts', "// test('comment', () => {});\ntest('executed', () => {});\nconst text = `test('string-only')`; t.test('nested', () => {});");
  assert.deepEqual([...titles].sort(), ['executed', 'nested']);
  const root = mkdtempSync(join(tmpdir(), 'mobile-contract-context-'));
  t.after(() => {
    assert.ok(root.startsWith(join(tmpdir(), 'mobile-contract-context-')));
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(join(root, 'route.ts'), 'version one');
  const first = sourceContextHash(root, ['route.ts']);
  writeFileSync(join(root, 'route.ts'), 'version two');
  assert.notEqual(sourceContextHash(root, ['route.ts']), first);
  mkdirSync(join(root, 'tests/helpers'), { recursive: true });
  mkdirSync(join(root, 'scripts/testing'), { recursive: true });
  const helper = join(root, 'tests/helpers/mock.ts');
  const transport = join(root, 'scripts/testing/isolated-model-provider.mjs');
  writeFileSync(helper, 'export const fixture = 1;');
  writeFileSync(transport, 'export const fixture = 1;');
  const initialHarness = serverContextHash(root);
  writeFileSync(helper, 'export const fixture = 2;');
  const changedHelper = serverContextHash(root);
  assert.notEqual(changedHelper, initialHarness);
  writeFileSync(transport, 'export const fixture = 2;');
  assert.notEqual(serverContextHash(root), changedHelper);
});
