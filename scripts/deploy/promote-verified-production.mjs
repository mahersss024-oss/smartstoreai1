import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const productionRepository = 'mahersss024-oss/smartstoreai1';
export const productionGatePath = '.github/workflows/production-gate.yml';
export const requiredPromotionJobs = [
  'Quality, Build, And Audit', 'Browser E2E (desktop-chromium)',
  'Browser E2E (mobile-chromium-layout)', 'Server API Contracts',
  'Mobile And PostgreSQL Contracts', 'Production Readiness',
];
const shaPattern = /^[a-f0-9]{40}$/;
const apiRoot = `https://api.github.com/repos/${productionRepository}`;

class PromotionFailure extends Error {}

export function eligiblePromotionEvent(event, repository) {
  const run = event?.workflow_run;
  return repository === productionRepository && event?.repository?.full_name === productionRepository &&
    run?.head_repository?.full_name === productionRepository && run.event === 'push' &&
    run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success' &&
    Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 &&
    shaPattern.test(run.head_sha ?? '');
}

/** The only write destination is this repository's production branch. */
export async function promoteVerifiedProduction({ event, repository, token, fetcher = globalThis.fetch }) {
  if (!eligiblePromotionEvent(event, repository)) return { outcome: 'skipped', reason: 'ineligible_event' };
  if (typeof token !== 'string' || !token.trim()) throw new PromotionFailure('A job-scoped GitHub token is required.');
  const eventRun = event.workflow_run;
  const sha = eventRun.head_sha;
  const context = { serverSha: sha, runId: eventRun.id, runAttempt: eventRun.run_attempt,
    gateUrl: `https://github.com/${productionRepository}/actions/runs/${eventRun.id}` };

  async function api(path, { method = 'GET', body, missing = false } = {}) {
    const controller = new AbortController();
    let reader;
    let timer;
    const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { reject(new PromotionFailure('GitHub verification timed out.')); controller.abort(); cancel(); }, 15_000);
      });
      const request = (async () => {
        const response = await fetcher(`${apiRoot}${path}`, {
          method, redirect: 'manual', credentials: 'omit', signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SouqHamad-Verified-Production',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (missing && response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
        if (response.redirected || response.status < 200 || response.status >= 300 ||
          (response.url && response.url !== `${apiRoot}${path}`)) {
          let category = 'request_rejected';
          if ([403, 422].includes(response.status) && response.body && !response.redirected) {
            reader = response.body.getReader();
            const decoder = new TextDecoder(); let message = ''; let bytes = 0;
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 8192) break;
              message += decoder.decode(part.value, { stream: true });
            }
            try {
              const reason = JSON.parse(message).message;
              if (typeof reason === 'string') {
                if (/workflow/i.test(reason) && /permission|refus/i.test(reason)) category = 'workflow_permission_required';
                else if (/protected|status check|rule violation/i.test(reason)) category = 'branch_protection_rejected';
                else if (/not accessible by integration/i.test(reason)) category = 'integration_permission_denied';
              }
            } catch { /* Raw provider diagnostics never enter the receipt. */ }
            cancel();
          } else void response.body?.cancel().catch(() => {});
          throw new PromotionFailure(`GitHub verification or branch update failed (HTTP ${response.status}; ${category}).`);
        }
        if (!response.body) throw new PromotionFailure('GitHub verification returned no JSON.');
        reader = response.body.getReader();
        const chunks = []; let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2 * 1024 * 1024) throw new PromotionFailure('GitHub verification exceeded its response limit.');
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new PromotionFailure('GitHub verification returned invalid JSON.'); }
      })();
      return await Promise.race([request, deadline]);
    } finally { clearTimeout(timer); cancel(); }
  }

  const workflow = await api(`/actions/workflows/${encodeURIComponent('production-gate.yml')}`);
  const run = await api(`/actions/runs/${eventRun.id}`);
  if (!eligiblePromotionEvent({ repository: { full_name: productionRepository }, workflow_run: run }, repository) ||
    workflow.path !== productionGatePath || workflow.state !== 'active' || run.workflow_id !== workflow.id ||
    run.id !== eventRun.id || run.head_sha !== sha || run.run_attempt !== eventRun.run_attempt) {
    throw new PromotionFailure('The completed run does not match the trusted gate and its current attempt.');
  }
  const jobs = [];
  for (let page = 1; page <= 5; page++) {
    const result = await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    if (!Array.isArray(result.jobs) || !Number.isSafeInteger(result.total_count) || result.total_count > 500) {
      throw new PromotionFailure('The gate job inventory is incomplete or invalid.');
    }
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) break;
    if (page === 5 || result.jobs.length === 0) throw new PromotionFailure('The complete gate job inventory was not returned.');
  }
  for (const name of requiredPromotionJobs) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
      throw new PromotionFailure('Every required gate job, including Production Readiness, must have succeeded in this attempt.');
    }
  }
  const main = await api('/git/ref/heads/main');
  if (main.object?.sha !== sha) return { ...context, outcome: 'skipped', reason: 'newer_main_exists' };
  const production = await api('/git/ref/heads/production', { missing: true });
  const before = production?.object?.sha ?? null;
  if (production !== null && !shaPattern.test(before ?? '')) throw new PromotionFailure('The production ref is invalid.');
  if (before === sha) return { ...context, outcome: 'unchanged', reason: 'already_current', previousSha: before };
  if (before) {
    const comparison = await api(`/compare/${before}...${sha}`);
    if (comparison.status !== 'ahead' || !(comparison.ahead_by > 0) || comparison.behind_by !== 0 ||
      comparison.merge_base_commit?.sha !== before) throw new PromotionFailure('Refusing a production rollback or divergent history.');
  }
  // A newer main may have arrived during job inventory or history checks.
  const currentMain = await api('/git/ref/heads/main');
  if (currentMain.object?.sha !== sha) return { ...context, outcome: 'skipped', reason: 'newer_main_exists' };
  if (before) await api('/git/refs/heads/production', { method: 'PATCH', body: { sha, force: false } });
  else await api('/git/refs', { method: 'POST', body: { ref: 'refs/heads/production', sha } });
  const after = await api('/git/ref/heads/production');
  if (after.object?.sha !== sha) throw new PromotionFailure('The production update could not be confirmed; inspect the ref before retrying.');
  return { ...context, outcome: 'promoted', previousSha: before, productionSha: sha };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const report = resolve(root, 'coverage/production-promotion.json');
  mkdirSync(dirname(report), { recursive: true });
  let result;
  try {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_run' || !process.env.GITHUB_EVENT_PATH) {
      throw new PromotionFailure('Run promotion only from the trusted workflow_run job.');
    }
    let event;
    try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); }
    catch { throw new PromotionFailure('The GitHub event could not be read.'); }
    result = { checkedAt: new Date().toISOString(), ...await promoteVerifiedProduction({ event,
      repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN }) };
  } catch (error) {
    result = { checkedAt: new Date().toISOString(), outcome: 'failed',
      reason: 'verification_or_update_failed', productionState: 'inspect_before_retry',
      ...(error instanceof PromotionFailure ? { diagnostic: error.message } : {}) };
    process.exitCode = 1;
  }
  writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `# Verified production promotion\n\nOutcome: ${result.outcome}\n\nServer: ${result.serverSha ?? 'not promoted'}\n\nGate: ${result.gateUrl ?? 'verification unavailable'}\n\nApp Runner must watch production. This result confirms the GitHub ref, not completion of an AWS deployment.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Production promotion could not save its verification receipt.'); process.exitCode = 1; });
}
