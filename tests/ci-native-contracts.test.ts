import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { evaluateProductionChecks } from '../scripts/testing/check-production-readiness.mjs';

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string | boolean;
  env?: Record<string, string>;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, string | number | boolean>;
};
type Job = {
  name?: string;
  'runs-on'?: string;
  if?: string | boolean;
  needs?: string[] | string;
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
  steps: Step[];
  services?: Record<string, {
    image: string;
    env?: Record<string, string>;
    ports?: string[];
    options?: string;
  }>;
};
const rootRequire = createRequire(resolve('package.json'));
const eslintRequire = createRequire(rootRequire.resolve('eslint'));
const yaml = eslintRequire('js-yaml') as { load: (source: string) => unknown };
const workflow = yaml.load(readFileSync('.github/workflows/production-gate.yml', 'utf8')) as {
  env?: Record<string, string>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const required = ['quality', 'e2e', 'api-contracts', 'mobile-contracts'];

function effectiveValue(value: unknown, job: Job): unknown {
  if (typeof value !== 'string') return value;
  const environment = value.match(/^\$\{\{\s*env\.([A-Z_]+)\s*\}\}$/);
  return environment ? job.env?.[environment[1]] ?? workflow.env?.[environment[1]] : value;
}

function requiredRun(job: Job, predicate: (step: Step) => boolean, purpose: string) {
  const step = job.steps.find(predicate);
  assert.ok(step, `Missing mandatory ${purpose} step`);
  assert.notEqual(step['continue-on-error'], true, `${purpose} failures must fail the job`);
  assert.equal(step.if, undefined, `${purpose} must run for every supported workflow invocation`);
  assert.doesNotMatch(step.run ?? '', /\|\|\s*(?:true|:)|continue-on-error/, `${purpose} must not swallow failure`);
  return step;
}

test('native backend CI is mandatory and uses an ephemeral loopback PostgreSQL service instead of hosted secrets', () => {
  const job = workflow.jobs['mobile-contracts'];
  assert.ok(job, 'The mobile contracts job must exist');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.if, undefined, 'Native backend coverage must not require an optional repository variable');
  assert.notEqual(job['continue-on-error'], true);
  const postgres = job.services?.postgres;
  assert.ok(postgres, 'A fresh job-scoped PostgreSQL service is required');
  assert.match(postgres.image, /^postgres:17(?:[.-].*)?$/);
  assert.equal(postgres.env?.POSTGRES_DB, 'smartstore_codex_test');
  assert.equal(postgres.env?.POSTGRES_USER, 'codex_local');
  assert.ok(postgres.ports?.includes('55432:5432'));
  assert.match(postgres.options ?? '', /pg_isready/);
  assert.match(postgres.options ?? '', /--health-retries/);
  const database = new URL(String(effectiveValue(job.env?.DATABASE_URL, job)));
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  assert.equal(database.username, 'codex_local');
  assert.equal(database.password, postgres.env?.POSTGRES_PASSWORD);
  assert.equal(job.env?.SMARTSTORE_CI_DB_TESTS, '1');
  const secretReferences = JSON.stringify(job).match(/secrets\.[A-Z0-9_]+/g) ?? [];
  assert.deepEqual(secretReferences, ['secrets.MOBILE_REPO_DEPLOY_KEY'],
    'The only credential in this job is the separate read-only key for the private mobile source repository');
  assert.doesNotMatch(JSON.stringify(job.env), /secrets\./, 'The disposable database receives no hosted database secrets');
  assert.equal(workflow.permissions.contents, 'read');
});

test('native CI checks a reproducible app revision and executes full mobile checks plus the reviewed operation map', () => {
  const job = workflow.jobs['mobile-contracts'];
  assert.ok(job);
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@') &&
    effectiveValue(step.with?.repository, job) === 'mahersss024-oss/app');
  assert.ok(checkout, 'Checkout must use the independent mobile repository');
  assert.equal(checkout.with?.path, 'AI');
  assert.match(String(effectiveValue(checkout.with?.ref, job)), /^[a-f0-9]{40}$/,
    'Pair this server revision with an immutable mobile commit, not mutable main');
  assert.equal(checkout.with?.['persist-credentials'], false);
  assert.equal(checkout.with?.['ssh-key'], '${{ secrets.MOBILE_REPO_DEPLOY_KEY }}');
  const pnpm = job.steps.find(step => step.uses?.startsWith('pnpm/action-setup@'));
  assert.ok(pnpm, 'CI must install the repository package manager explicitly');
  assert.equal(String(pnpm.with?.version), '10.32.1');
  const node = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(node, 'CI must select the supported Node runtime');
  assert.equal(node.with?.['node-version-file'], '.nvmrc');
  assert.equal(readFileSync('.nvmrc', 'utf8').trim(), '24');
  requiredRun(job, step => step.run === 'pnpm install --frozen-lockfile' && !step['working-directory'], 'locked server dependency installation');
  requiredRun(job, step => step.run === 'pnpm install --frozen-lockfile' && step['working-directory'] === 'AI', 'locked mobile dependency installation');
  requiredRun(job, step => step.run === 'pnpm check' && step['working-directory'] === 'AI', 'mobile types and lint');
  const browser = requiredRun(job, step => step.run === 'pnpm exec playwright install --with-deps chromium' &&
    step['working-directory'] === 'AI', 'browser prerequisite for real React reconciliation tests');
  assert.ok(job.steps.indexOf(browser) < job.steps.findIndex(step => step.run === 'pnpm test' && step['working-directory'] === 'AI'),
    'The browser must be installed before mobile tests so reconciliation checks cannot silently skip');
  requiredRun(job, step => step.run === 'pnpm test' && step['working-directory'] === 'AI', 'full mobile helper suite');
  const mapped = requiredRun(job, step => /\bpnpm test:mobile-contracts\b/.test(step.run ?? '') &&
    ['--run-node', '--run-mobile', '--run-postgres'].every(flag => step.run!.includes(flag)), 'mapped server/mobile/PostgreSQL contracts');
  assert.equal(mapped['working-directory'], undefined);
});

test('native CI preserves verification artifacts on failures without hiding missing evidence', () => {
  const job = workflow.jobs['mobile-contracts'];
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(upload, 'Native contracts must upload evidence for diagnosing failures');
  assert.equal(upload.if, '${{ always() }}');
  assert.notEqual(upload['continue-on-error'], true);
  const paths = String(upload.with?.path ?? '');
  for (const extension of ['json', 'md', 'log']) {
    assert.ok(paths.includes(`coverage/mobile-*.${extension}`), `The ${extension} evidence must be retained`);
  }
  assert.ok(Number(upload.with?.['retention-days']) > 0);
});

test('production readiness waits for every required job and evaluates their actual results even after failure', () => {
  const job = workflow.jobs['production-readiness'];
  assert.ok(job, 'A single final required status must exist');
  assert.equal(job.if, '${{ always() }}');
  assert.notEqual(job['continue-on-error'], true);
  assert.deepEqual((Array.isArray(job.needs) ? [...job.needs] : [job.needs]).sort(), [...required].sort());
  assert.ok(![job.needs].flat().includes('optional-db-integration'), 'An intentionally optional hosted staging job must not masquerade as mandatory coverage');
  const gate = requiredRun(job, step => step.run === 'node scripts/testing/check-production-readiness.mjs', 'final production readiness decision');
  assert.equal(gate.env?.REQUIRED_JOB_RESULTS, '${{ toJSON(needs) }}');
});

test('production readiness cannot pass on missing skipped cancelled or failed required checks', () => {
  const successful = Object.fromEntries(required.map(job => [job, { result: 'success' }]));
  assert.equal(evaluateProductionChecks(successful).passed, true);
  for (const job of required) {
    for (const result of ['failure', 'cancelled', 'skipped', 'unknown']) {
      const decision = evaluateProductionChecks({ ...successful, [job]: { result }, 'optional-db-integration': { result: 'success' } });
      assert.equal(decision.passed, false, `${job} ${result} must prevent readiness`);
    }
    const missing = { ...successful };
    delete missing[job];
    assert.equal(evaluateProductionChecks(missing).passed, false, `${job} absence must prevent readiness`);
  }
  assert.equal(evaluateProductionChecks({}).passed, false);
  assert.equal(evaluateProductionChecks({ 'optional-db-integration': { result: 'success' } }).passed, false);
});
