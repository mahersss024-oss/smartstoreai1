import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import playwrightConfig from '../playwright.config';

type Step = {
  name: string;
  run?: string;
  uses?: string;
  if?: string;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  with?: Record<string, string | number>;
};
type Job = {
  name: string;
  steps: Step[];
  'timeout-minutes': number;
  'continue-on-error'?: boolean;
  strategy: { 'fail-fast': boolean; matrix: { project: string[] } };
};
const rootRequire = createRequire(resolve('package.json'));
const eslintRequire = createRequire(rootRequire.resolve('eslint'));
const yaml = eslintRequire('js-yaml') as { load: (source: string) => unknown };
const workflow = yaml.load(readFileSync('.github/workflows/production-gate.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const browser = workflow.jobs.e2e;

test('CI browser matrix runs every configured project independently without canceling the other project', () => {
  const projects = playwrightConfig.projects!.map(project => project.name).sort();
  assert.deepEqual([...browser.strategy.matrix.project].sort(), projects);
  assert.equal(new Set(browser.strategy.matrix.project).size, projects.length);
  assert.equal(browser.strategy['fail-fast'], false);
  assert.notEqual(browser['continue-on-error'], true);
  assert.ok(browser.name.includes('${{ matrix.project }}'));
  const step = browser.steps.find(step => step.name === 'Run E2E journey tests')!;
  assert.equal(step.run, 'pnpm test:e2e --project=${{ matrix.project }}');
  assert.notEqual(step['continue-on-error'], true);
  assert.equal(playwrightConfig.workers, 1);
  assert.equal(playwrightConfig.timeout, 30_000);
  assert.equal(playwrightConfig.globalTimeout, 1_800_000);
  const webServers = playwrightConfig.webServer;
  const webServer = Array.isArray(webServers) ? webServers[0] : webServers;
  assert.equal(webServer?.url, 'http://127.0.0.1:3102/api/health');
});

test('CI reserves time for Playwright termination, report upload and setup', () => {
  const run = browser.steps.find(step => step.name === 'Run E2E journey tests')!;
  const upload = browser.steps.find(step => step.name === 'Upload Playwright reports')!;
  assert.ok(run['timeout-minutes']! * 60_000 > playwrightConfig.globalTimeout!);
  assert.ok(browser['timeout-minutes'] >= run['timeout-minutes']! + upload['timeout-minutes']! + 5);
});

test('reports and traces upload on failures and cancellations without hiding failures', () => {
  const upload = browser.steps.find(step => step.name === 'Upload Playwright reports')!;
  assert.equal(upload.if, '${{ always() }}');
  assert.equal(upload.uses, 'actions/upload-artifact@v4');
  assert.equal(upload.with!.name, 'playwright-${{ matrix.project }}-${{ github.run_attempt }}');
  assert.equal(upload.with!.path, 'playwright-report/\ntest-results/\n');
  assert.equal(upload.with!['retention-days'], 14);
  assert.notEqual(upload['continue-on-error'], true);
  assert.equal(playwrightConfig.use?.trace, 'retain-on-failure');
  assert.equal(playwrightConfig.use?.screenshot, 'only-on-failure');
  assert.equal(workflow.jobs.quality.steps.find(step => step.name === 'Dependency audit')!.run,
    'pnpm audit --audit-level moderate');
});
