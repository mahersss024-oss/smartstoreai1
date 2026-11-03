import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { eligiblePromotionEvent, productionRepository, promoteVerifiedProduction,
  requiredPromotionJobs } from '../scripts/deploy/promote-verified-production.mjs';

const targetSha = 'b'.repeat(40);
const beforeSha = 'a'.repeat(40);
const newerSha = 'c'.repeat(40);
const runId = 123456;
const runPath = `/actions/runs/${runId}`;
const jobsPath = `${runPath}/attempts/1/jobs?per_page=100&page=1`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function harness(initialProduction: string | null = beforeSha) {
  const event = { repository: { full_name: productionRepository }, workflow_run: {
    id: runId, run_attempt: 1, head_sha: targetSha, head_branch: 'main', status: 'completed',
    conclusion: 'success', event: 'push', head_repository: { full_name: productionRepository },
  } };
  const run = { ...structuredClone(event.workflow_run), workflow_id: 789 };
  const jobs = requiredPromotionJobs.map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const overrides = new Map<string, () => Response>();
  const calls: { path: string; method: string; body: unknown }[] = [];
  const mainShas = [targetSha];
  let mainReads = 0;
  let productionSha = initialProduction;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    assert.ok(url.pathname.startsWith(`/repos/${productionRepository}/`));
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.credentials, 'omit');
    assert.ok(init?.signal);
    const path = url.pathname.slice(`/repos/${productionRepository}`.length) + url.search;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    const override = overrides.get(`${method} ${path}`);
    if (override) return override();
    if (path === '/actions/workflows/production-gate.yml') {
      return json({ id: 789, path: '.github/workflows/production-gate.yml', state: 'active' });
    }
    if (path === runPath) return json(run);
    if (path === jobsPath) return json({ total_count: jobs.length, jobs });
    if (path === '/git/ref/heads/main') return json({ object: { sha: mainShas[Math.min(mainReads++, mainShas.length - 1)] } });
    if (path === '/git/ref/heads/production') return productionSha ? json({ object: { sha: productionSha } }) : json({}, 404);
    if (path.startsWith('/compare/')) return json({ status: 'ahead', ahead_by: 1, behind_by: 0, merge_base_commit: { sha: beforeSha } });
    if (method === 'PATCH' && path === '/git/refs/heads/production') {
      assert.deepEqual(body, { sha: targetSha, force: false });
      productionSha = body.sha;
      return json({ object: { sha: productionSha } });
    }
    if (method === 'POST' && path === '/git/refs') {
      assert.deepEqual(body, { ref: 'refs/heads/production', sha: targetSha });
      productionSha = body.sha;
      return json({ object: { sha: productionSha } }, 201);
    }
    throw new Error('Unexpected verification request.');
  };
  const invoke = () => promoteVerifiedProduction({ event, repository: productionRepository, token: 'offline-test-token', fetcher });
  return { event, run, jobs, overrides, calls, mainShas, fetcher, invoke,
    writes: () => calls.filter(call => call.method !== 'GET') };
}

test('production promotion rejects failed, fork, PR, manual and malformed events without a network request', async () => {
  const changes = [
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.conclusion = 'failure'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.status = 'in_progress'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.event = 'pull_request'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.event = 'workflow_dispatch'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.head_branch = 'feature'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.head_repository.full_name = 'someone/fork'; },
    (event: ReturnType<typeof harness>['event']) => { event.repository.full_name = 'someone/fork'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.head_sha = 'branch; arbitrary'; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.run_attempt = 0; },
    (event: ReturnType<typeof harness>['event']) => { event.workflow_run.id = -1; },
  ];
  for (const change of changes) {
    const h = harness(); change(h.event);
    assert.equal(eligiblePromotionEvent(h.event, productionRepository), false);
    assert.equal((await h.invoke()).outcome, 'skipped');
    assert.equal(h.calls.length, 0);
  }
});

test('a successful current trusted gate advances only production with force false and confirms its SHA', async () => {
  const h = harness();
  const result = await h.invoke();
  assert.equal(result.outcome, 'promoted');
  assert.ok('serverSha' in result && 'productionSha' in result && 'previousSha' in result);
  assert.equal(result.serverSha, targetSha);
  assert.equal(result.productionSha, targetSha);
  assert.equal(result.previousSha, beforeSha);
  assert.deepEqual(h.writes(), [{ path: '/git/refs/heads/production', method: 'PATCH', body: { sha: targetSha, force: false } }]);
  assert.equal(h.calls.at(-1)?.path, '/git/ref/heads/production');
  assert.doesNotMatch(JSON.stringify(result), /offline-test-token/);
});

test('initial promotion creates only the missing production ref and a rerun at its target is read-only', async () => {
  const empty = harness(null);
  assert.equal((await empty.invoke()).outcome, 'promoted');
  assert.deepEqual(empty.writes(), [{ path: '/git/refs', method: 'POST', body: { ref: 'refs/heads/production', sha: targetSha } }]);
  const current = harness(targetSha);
  assert.equal((await current.invoke()).outcome, 'unchanged');
  assert.equal(current.writes().length, 0);
});

test('promotion requires this trusted workflow, run attempt and successful mandatory jobs', async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => { h.run.workflow_id++; },
    (h: ReturnType<typeof harness>) => { h.run.run_attempt++; },
    (h: ReturnType<typeof harness>) => { h.run.head_sha = newerSha; },
    (h: ReturnType<typeof harness>) => { h.run.conclusion = 'failure'; },
    (h: ReturnType<typeof harness>) => { h.jobs.pop(); },
    (h: ReturnType<typeof harness>) => { h.jobs.push({ name: 'Production Readiness', status: 'completed', conclusion: 'success' }); },
    (h: ReturnType<typeof harness>) => { h.overrides.set('GET /actions/workflows/production-gate.yml',
      () => json({ id: 789, path: '.github/workflows/something-else.yml', state: 'active' })); },
  ]) {
    const h = harness(); mutate(h);
    await assert.rejects(h.invoke());
    assert.equal(h.writes().length, 0);
  }
  for (const name of requiredPromotionJobs) {
    for (const conclusion of ['failure', 'skipped', 'cancelled']) {
      const h = harness(); h.jobs.find(job => job.name === name)!.conclusion = conclusion;
      await assert.rejects(h.invoke());
      assert.equal(h.writes().length, 0);
    }
  }
});

test('an older successful run cannot publish after main changes before or during verification', async () => {
  for (const reads of [[newerSha], [targetSha, newerSha]]) {
    const h = harness(); h.mainShas.splice(0, h.mainShas.length, ...reads);
    const result = await h.invoke();
    assert.equal(result.outcome, 'skipped');
    assert.equal(result.reason, 'newer_main_exists');
    assert.equal(h.writes().length, 0);
  }
});

test('a production rollback or divergent history is refused before writing', async () => {
  for (const comparison of [
    { status: 'behind', ahead_by: 0, behind_by: 1, merge_base_commit: { sha: targetSha } },
    { status: 'diverged', ahead_by: 1, behind_by: 1, merge_base_commit: { sha: newerSha } },
    { status: 'ahead', ahead_by: 1, behind_by: 0, merge_base_commit: { sha: newerSha } },
  ]) {
    const h = harness(); h.overrides.set(`GET /compare/${beforeSha}...${targetSha}`, () => json(comparison));
    await assert.rejects(h.invoke(), /rollback or divergent/);
    assert.equal(h.writes().length, 0);
  }
});

test('API update conflicts never cause a force fallback and unavailable verification never writes', async () => {
  for (const status of [403, 422]) {
    const h = harness(); h.overrides.set('PATCH /git/refs/heads/production', () => json({ message: 'provider diagnostic' }, status));
    await assert.rejects(h.invoke(), /branch update failed/);
    assert.equal(h.writes().length, 1);
    assert.deepEqual(h.writes()[0].body, { sha: targetSha, force: false });
  }
  const h = harness(); h.overrides.set(`GET ${runPath}`, () => json({ message: 'unavailable' }, 503));
  await assert.rejects(h.invoke());
  assert.equal(h.writes().length, 0);
});

test('job pagination cannot omit the final status or silently truncate verification', async () => {
  const h = harness();
  const first = [...h.jobs.slice(0, -1), ...Array.from({ length: 95 }, (_, index) => ({ name: `extra-${index}`, status: 'completed', conclusion: 'skipped' }))];
  h.overrides.set(`GET ${jobsPath}`, () => json({ total_count: 101, jobs: first }));
  h.overrides.set(`GET ${jobsPath.replace(/&page=1$/, '&page=2')}`, () => json({ total_count: 101, jobs: h.jobs.slice(-1) }));
  assert.equal((await h.invoke()).outcome, 'promoted');
  const incomplete = harness();
  incomplete.overrides.set(`GET ${jobsPath}`, () => json({ total_count: 101, jobs: first }));
  incomplete.overrides.set(`GET ${jobsPath.replace(/&page=1$/, '&page=2')}`, () => json({ total_count: 101, jobs: [] }));
  await assert.rejects(incomplete.invoke(), /complete gate job inventory/);
  assert.equal(incomplete.writes().length, 0);
});

test('provider redirects and malformed JSON fail without exposing response data or changing the ref', async () => {
  for (const response of [
    () => new Response('', { status: 302, headers: { location: 'https://other.invalid/' } }),
    () => new Response('{"password":SECRET1234}', { status: 200 }),
  ]) {
    const h = harness(); h.overrides.set(`GET ${runPath}`, response);
    await assert.rejects(h.invoke(), error => {
      assert.doesNotMatch(String(error), /SECRET1234|offline-test-token/);
      return true;
    });
    assert.equal(h.writes().length, 0);
  }
});

test('promotion workflow trusts only main-push gate completions and isolates its write permission', () => {
  const rootRequire = createRequire(resolve('package.json'));
  const yaml = createRequire(rootRequire.resolve('eslint'))('js-yaml') as { load: (input: string) => unknown };
  const workflow = yaml.load(readFileSync('.github/workflows/promote-production.yml', 'utf8')) as {
    on: { workflow_run: { workflows: string[]; types: string[] } };
    permissions: Record<string, string>; concurrency: { group: string; 'cancel-in-progress': boolean };
    jobs: { promote: { if: string; permissions: Record<string, string>; steps: {
      uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string>;
    }[] } };
  };
  assert.deepEqual(workflow.on, { workflow_run: { workflows: ['Production Gate'], types: ['completed'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.jobs.promote.permissions, { actions: 'read', contents: 'write' });
  for (const guard of ['success', "event == 'push'", "head_branch == 'main'", 'head_repository.full_name == github.repository']) {
    assert.ok(workflow.jobs.promote.if.includes(guard));
  }
  const checkout = workflow.jobs.promote.steps.find(step => step.uses?.startsWith('actions/checkout@'))!;
  assert.equal(checkout.with?.['persist-credentials'], false);
  assert.equal(checkout.with?.ref, undefined, 'Never checkout untrusted workflow_run head code');
  const action = workflow.jobs.promote.steps.find(step => step.run)!;
  assert.equal(action.run, 'node scripts/deploy/promote-verified-production.mjs');
  assert.deepEqual(action.env, { GITHUB_TOKEN: '${{ github.token }}' });
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|AWS_|pull_request_target/);
  assert.equal(workflow.jobs.promote.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))?.if, '${{ always() }}');
});
