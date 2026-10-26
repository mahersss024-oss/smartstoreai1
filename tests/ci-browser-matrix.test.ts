import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
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
const apiContracts = workflow.jobs['api-contracts'];
const browserProjects = playwrightConfig.projects!.filter(project => project.name !== 'api-contracts');
const adminSpecs = [
  'app-download-gateway.spec.ts',
  'admin-page-presentation.spec.ts', 'admin-users-loading.spec.ts', 'admin-workspace.spec.ts',
  'all-pages-vitals.spec.ts', 'customer-evidence.spec.ts', 'marketplace-car-models.spec.ts',
  'marketplace-categories.spec.ts', 'performance-stability.spec.ts', 'route-contracts.spec.ts',
].sort();

function matchedSpecNames(match: string | RegExp | (string | RegExp)[] | undefined) {
  assert.ok(match, 'Each project must explicitly declare its supported test files');
  return (Array.isArray(match) ? match : [match]).map(pattern => {
    assert.equal(typeof pattern, 'string', 'Use an explicit file allowlist, not a broad regular expression');
    return String(pattern).replace(/^\*\*\//, '');
  }).sort();
}

test('CI browser matrix runs both administrator browser projects independently without including the API project', () => {
  const projects = browserProjects.map(project => project.name).sort();
  assert.deepEqual(projects, ['desktop-chromium', 'mobile-chromium-layout']);
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

test('browser projects include the public app gateway and administrator UI without retired customer journeys', () => {
  for (const project of browserProjects) {
    assert.deepEqual(matchedSpecNames(project.testMatch), adminSpecs);
  }
  for (const file of ['e2e/all-pages-vitals.spec.ts', 'e2e/route-contracts.spec.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /item\.path === '\/admin' \|\| item\.path\?\.startsWith\('\/admin\/'\)/,
      `${file} must restrict dynamically discovered page cases to administrator pages`);
  }
});

test('API contracts use request fixtures independently and do not require a browser installation', () => {
  const project = playwrightConfig.projects!.find(project => project.name === 'api-contracts')!;
  assert.ok(project, 'The independent API project must be configured');
  assert.deepEqual(matchedSpecNames(project.testMatch), ['api-contracts.spec.ts', 'listing-reference.spec.ts']);
  const run = apiContracts.steps.find(step => step.name === 'Run request-only API contracts')!;
  assert.equal(run.run, 'pnpm test:e2e --project=api-contracts');
  assert.notEqual(apiContracts['continue-on-error'], true);
  assert.notEqual(run['continue-on-error'], true);
  assert.equal(apiContracts.steps.some(step => step.run?.includes('playwright install')), false);
  for (const file of ['e2e/api-contracts.spec.ts', 'e2e/listing-reference.spec.ts']) {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const browserFixtures: string[] = [];
    const inspect = (node: ts.Node) => {
      if (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
        for (const parameter of node.parameters) {
          if (!ts.isObjectBindingPattern(parameter.name)) continue;
          for (const element of parameter.name.elements) {
            const fixture = (element.propertyName ?? element.name).getText(ast);
            if (['page', 'browser', 'context', 'browserName'].includes(fixture)) browserFixtures.push(fixture);
          }
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    assert.deepEqual(browserFixtures, [], `${file} must remain executable without a browser`);
  }
});

test('CI reserves time for Playwright termination, report upload and setup', () => {
  const run = browser.steps.find(step => step.name === 'Run E2E journey tests')!;
  const upload = browser.steps.find(step => step.name === 'Upload Playwright reports')!;
  assert.ok(run['timeout-minutes']! * 60_000 > playwrightConfig.globalTimeout!);
  assert.ok(browser['timeout-minutes'] >= run['timeout-minutes']! + upload['timeout-minutes']! + 5);
  const apiRun = apiContracts.steps.find(step => step.name === 'Run request-only API contracts')!;
  const apiUpload = apiContracts.steps.find(step => step.name === 'Upload API contract reports')!;
  assert.ok(apiRun['timeout-minutes']! * 60_000 > playwrightConfig.globalTimeout!);
  assert.ok(apiContracts['timeout-minutes'] >= apiRun['timeout-minutes']! + apiUpload['timeout-minutes']! + 5);
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
  const apiUpload = apiContracts.steps.find(step => step.name === 'Upload API contract reports')!;
  assert.equal(apiUpload.if, '${{ always() }}');
  assert.equal(apiUpload.with!.name, 'playwright-api-contracts-${{ github.run_attempt }}');
  assert.equal(apiUpload.with!.path, 'playwright-report/\ntest-results/\n');
  assert.equal(apiUpload.with!['retention-days'], 14);
  assert.notEqual(apiUpload['continue-on-error'], true);
});
