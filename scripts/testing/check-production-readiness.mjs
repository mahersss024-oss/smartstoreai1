import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredProductionJobs = ['quality', 'e2e', 'api-contracts', 'mobile-contracts'];

export function evaluateProductionChecks(outcomes) {
  const results = requiredProductionJobs.map(job => ({
    job, result: outcomes && typeof outcomes === 'object' && typeof outcomes[job]?.result === 'string'
      ? outcomes[job].result : 'missing',
  }));
  return { passed: results.every(entry => entry.result === 'success'), results };
}

function main() {
  let outcomes;
  try { outcomes = JSON.parse(process.env.REQUIRED_JOB_RESULTS ?? '{}'); }
  catch { console.error('Required job results must be valid JSON.'); process.exitCode = 1; return; }
  const assessment = evaluateProductionChecks(outcomes);
  const report = ['# Production Gate required checks', '',
    '| Required check | Result |', '| --- | --- |',
    ...assessment.results.map(entry => `| ${entry.job} | ${['success', 'failure', 'cancelled', 'skipped', 'missing'].includes(entry.result) ? entry.result : 'invalid'} |`),
    '', assessment.passed ? 'All required automated checks passed.' : 'One or more required checks did not succeed.', '',
    'This result covers automated checks for the checked-out server and pinned mobile source. Live providers, physical devices and AWS deployment approval remain separate.', ''].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  console.log(report);
  if (!assessment.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
