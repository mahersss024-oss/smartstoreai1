import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mobileAccountContracts } from './testing/mobile-account-contracts';
import { mobileMarketplaceContracts } from './testing/mobile-marketplace-contracts';
import { attachMobileActionBindings } from './testing/mobile-action-bindings';
import { buildMobileOperationMap } from './testing/mobile-operation-map';

const root = process.cwd();
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--mobile-root');
const mobileRoot = resolve(rootIndex >= 0 ? args[rootIndex + 1] : existsSync(join(root, 'AI/src')) ? 'AI' : '../AI');
const contracts = attachMobileActionBindings([...mobileAccountContracts, ...mobileMarketplaceContracts]);
type Report = ReturnType<typeof buildMobileOperationMap>;

function isolatedEnvironment(contextHash: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const keys = new Set(Object.keys(env));
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local']) {
    if (!existsSync(join(root, file))) continue;
    // Inspect names only; never print or copy secret values from environment files.
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)) keys.add(match[1]);
  }
  for (const name of keys) {
    if (/^(DATABASE_URL$|DIRECT_URL$|SHADOW_DATABASE_URL$|SMARTSTORE_(OBJECT_STORAGE|EVIDENCE_STORAGE|VAPID|IMAGE_WORKER|DIRECT_IMAGE|IMAGE_INTAKE|RUN_DB_MIGRATIONS)|CLOUDFLARE_|R2_|S3_|AWS_|UPSTASH_|FIREBASE_|APNS_|GOOGLE_|APPLE_)/.test(name)) env[name] = '';
  }
  return { ...env, CI: '1', NODE_ENV: 'test', AUTH_SECRET: 'isolated-mobile-contract-run-only',
    DEEPSEEK_API_KEY: 'test-model-placeholder', SMARTSTORE_MARKETPLACE_STORE: 'file',
    SMARTSTORE_IMAGE_STORAGE: 'inline', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    SMARTSTORE_DB_INTEGRATION: '0', SMARTSTORE_OWNER_RESET_INTEGRATION: '0',
    SMARTSTORE_RUN_DB_MIGRATIONS_ON_START: '0', SMARTSTORE_CONTRACT_CONTEXT_HASH: contextHash };
}

async function run(command: string, commandArgs: string[], cwd: string, env: NodeJS.ProcessEnv, logName: string) {
  const log = openSync(join(root, 'coverage', logName), 'w');
  try {
    return await new Promise<number>((done, reject) => {
      const child = spawn(command, commandArgs, { cwd, env, stdio: ['ignore', log, log] });
      child.once('error', reject);
      child.once('exit', code => done(code ?? 1));
    });
  } finally { closeSync(log); }
}

function writeReport(report: Report) {
  mkdirSync(join(root, 'coverage'), { recursive: true });
  writeFileSync(join(root, 'coverage/mobile-operation-map.json'), JSON.stringify(report, null, 2) + '\n');
  const escape = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [
    '# Mobile operations and backend verification', '',
    `Generated: ${report.generatedAt}`, '',
    report.interpretation, '',
    `${report.summary.operations} reviewed operations; ${report.summary.apiCallsites} API callsites; ${report.summary.uniqueMobileEndpoints} unique server method/path pairs.`, '',
    'A passed scenario proves only the assertions listed below. Runtime mocks, database integration and native device checks are distinct evidence.', '',
    '## Validation', '',
    ...(report.validationErrors.length ? report.validationErrors.map(error => `- ${error}`) : ['No missing route, source-file, action-anchor, static scenario title or unmapped inventoried API callsite.']), '',
  ];
  for (const operation of report.operations) {
    lines.push(`## ${operation.id}: ${operation.label}`, '',
      `Scenario result: **${operation.scenarioResult}**. Complete behavior is not automatically certified.`, '',
      ...operation.serverEffects.map(effect => `- Expected effect: ${effect}`), '',
      ...operation.serverRoutes.map(route => `- Server: \`${route.id}\` — ${route.file}:${route.line}`),
      ...operation.callsiteReferences.map(call => `- Mobile candidate: ${call.file}:${call.line} — \`${call.method} ${call.path}${call.query ? '?' + call.query : ''}\``),
      ...operation.actionEvidence.map(anchor => `- Reviewed action: ${anchor.file}:${anchor.line} — ${anchor.description} (\`${anchor.sourceText}\`)`), '',
      '| Existing named scenario | Execution | What its assertions verify |', '| --- | --- | --- |');
    for (const scenario of operation.scenarios) {
      lines.push(`| ${escape(scenario.file)}: ${escape(scenario.testTitle)} | ${scenario.mode}: ${scenario.evidence.result} | ${escape(scenario.verifies.join(' '))} |`);
    }
    if (!operation.scenarios.length) lines.push('| No reviewed runtime scenario mapped | not-run | Requires review or a focused test |');
    lines.push('', 'Remaining checks:', '', ...operation.remainingChecks.map(check => `- ${check}`), '');
  }
  lines.push('## Transport and live-service limits', '', ...report.limitations.map(limit => `- ${limit}`), '');
  writeFileSync(join(root, 'coverage/mobile-operation-map.md'), lines.join('\n'));
}

async function main() {
  let report = buildMobileOperationMap(root, mobileRoot, contracts);
  writeReport(report);
  if (report.validationErrors.length) {
    console.error(report.validationErrors.join('\n'));
    process.exitCode = 1;
    return;
  }
  const uniqueFiles = (mode: string) => [...new Set(contracts.flatMap(contract => contract.scenarios)
    .filter(scenario => scenario.mode === mode).map(scenario => scenario.file.replace(/^mobile:/, '')))].sort();
  let runFailed = false;
  if (args.includes('--run-node')) {
    console.log('Running mapped server Node test files with isolated storage and model transport.');
    const code = await run(process.execPath, ['scripts/test.mjs', '--test-reporter=spec', '--test-reporter-destination=stdout',
      '--test-reporter=./scripts/testing/mobile-test-reporter.mjs', '--test-reporter-destination=coverage/mobile-contract-results-node.json',
      ...uniqueFiles('node')], root, isolatedEnvironment(report.sourceContext.server), 'mobile-contracts-node.log');
    console.log(`Server Node tests exited ${code}.`);
    runFailed ||= code !== 0;
  }
  if (args.includes('--run-mobile')) {
    console.log('Running mapped mobile helper tests; native providers are mocked by their existing harnesses.');
    const code = await run(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
      `--test-reporter=${pathToFileURL(join(root, 'scripts/testing/mobile-test-reporter.mjs')).href}`,
      `--test-reporter-destination=${join(root, 'coverage/mobile-contract-results-mobile.json')}`,
      ...uniqueFiles('mobile-node')], mobileRoot, isolatedEnvironment(report.sourceContext.mobile), 'mobile-contracts-mobile.log');
    console.log(`Mobile helper tests exited ${code}.`);
    runFailed ||= code !== 0;
  }
  if (args.includes('--run-postgres')) {
    if (process.platform !== 'win32') throw new Error('The dedicated PostgreSQL runner uses this workspace Windows local cluster; use a separately reviewed runner on other systems.');
    console.log('Running mapped PostgreSQL tests on the dedicated loopback test database.');
    const plan = join(root, 'coverage/mobile-contracts-run-plan.json');
    writeFileSync(plan, JSON.stringify({ postgresFiles: uniqueFiles('postgres'), serverContextHash: report.sourceContext.server }, null, 2));
    const code = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      'scripts/testing/run-mobile-postgres-contracts.ps1', '-PlanPath', plan], root,
    isolatedEnvironment(report.sourceContext.server), 'mobile-contracts-postgres-runner.log');
    console.log(`PostgreSQL tests exited ${code}.`);
    runFailed ||= code !== 0;
  }
  report = buildMobileOperationMap(root, mobileRoot, contracts);
  writeReport(report);
  console.log(JSON.stringify({ ...report.summary, receipts: report.receipts,
    reports: ['coverage/mobile-operation-map.json', 'coverage/mobile-operation-map.md'] }, null, 2));
  if (runFailed) process.exitCode = 1;
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
