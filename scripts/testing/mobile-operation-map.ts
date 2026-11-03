import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { buildInventory, type InventoryItem } from './inventory';
import { buildMobileApiInventory, type MobileApiCallsite } from './mobile-api-inventory';
import type { MobileOperationContract, MobileScenario } from './mobile-operation-types';

export function routeShape(path: string) {
  return path.split('?')[0].split('/').filter(Boolean)
    .map(segment => /^\[[^/]+\]$/.test(segment) ? '[param]' : segment).join('/');
}

export function testTitles(file: string, source: string) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const titles = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      const isTest = ts.isIdentifier(callee) && ['test', 'it'].includes(callee.text) ||
        ts.isPropertyAccessExpression(callee) && (callee.name.text === 'test' ||
          ts.isIdentifier(callee.expression) && ['test', 'it'].includes(callee.expression.text) && ['skip', 'only', 'todo'].includes(callee.name.text));
      if (isTest) titles.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return titles;
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}

export function sourceHash(file: string) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

export function sourceContextHash(root: string, files: string[]) {
  const digest = createHash('sha256');
  for (const file of [...new Set(files)].sort()) digest.update(file).update('\0').update(readFileSync(join(root, file))).update('\0');
  return digest.digest('hex');
}

export function serverContextHash(root: string) {
  const files = ['agent', 'app', 'components', 'hooks', 'lib', 'prisma', 'cloudflare', 'tests/helpers', 'scripts/testing']
    .flatMap(directory => walk(join(root, directory)))
    .filter(file => /\.(?:[cm]?[jt]sx?|sql|prisma)$/.test(file) && !/\.test\./.test(file))
    .map(file => file.slice(root.length + 1).replaceAll('\\', '/'));
  const configuration = ['proxy.ts', 'next.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'scripts/test.mjs']
    .filter(file => existsSync(join(root, file)));
  return sourceContextHash(root, [...files, ...configuration]);
}

type TestReceipt = {
  contextHash: string | null;
  createdAt: string;
  summary: Record<string, number>;
  tests: Array<{ file: string | null; name: string; sourceHash: string | null; status: string }>;
};

function readReceipt(file: string): TestReceipt | undefined {
  if (!existsSync(file)) return undefined;
  const source = readFileSync(file, 'utf8');
  // A reporter may open its output before its loader fails. Empty output is no execution proof.
  if (!source.trim()) return undefined;
  return JSON.parse(source) as TestReceipt;
}

export function scenarioEvidence(root: string, mobileRoot: string, scenario: MobileScenario,
  contextHash: string, receipt: TestReceipt | undefined) {
  const sourceRoot = scenario.file.startsWith('mobile:') ? mobileRoot : root;
  const file = scenario.file.replace(/^mobile:/, '');
  const fullPath = join(sourceRoot, file);
  if (!existsSync(fullPath)) return { valid: false, error: `Missing test file: ${scenario.file}`, result: 'not-run' };
  if (!testTitles(file, readFileSync(fullPath, 'utf8')).has(scenario.testTitle)) {
    return { valid: false, error: `Missing static test title in ${scenario.file}: ${scenario.testTitle}`, result: 'not-run' };
  }
  const matches = receipt?.tests.filter(test => test.file === file && test.name === scenario.testTitle) ?? [];
  const recordedResult = matches.some(test => test.status === 'failed') ? 'failed' :
    matches.some(test => test.status !== 'passed') ? matches.find(test => test.status !== 'passed')!.status :
      matches.length > 0 ? 'passed' : null;
  const current = matches.length > 0 && receipt?.contextHash === contextHash &&
    matches.every(test => test.sourceHash === sourceHash(fullPath));
  return { valid: true, result: recordedResult ? current ? recordedResult : 'stale-result' : 'not-run',
    recordedResult, executedAt: matches.length > 0 ? receipt?.createdAt : null,
    sourceHash: sourceHash(fullPath), contextMatches: Boolean(current) };
}

export function buildMobileOperationMap(root: string, mobileRoot: string, contracts: MobileOperationContract[]) {
  const inventory = buildMobileApiInventory(mobileRoot);
  const endpoints = buildInventory(root).items.filter(item => item.kind === 'endpoint');
  const backendHash = serverContextHash(root);
  const clientConfiguration = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'app.json', 'app.config.ts', 'app.config.js']
    .filter(file => existsSync(join(mobileRoot, file)));
  const clientHarnessFiles = ['tests', 'scripts'].flatMap(directory => walk(join(mobileRoot, directory)))
    .filter(file => /\.[cm]?[jt]sx?$/.test(file))
    .map(file => file.slice(mobileRoot.length + 1).replaceAll('\\', '/'));
  const clientHash = sourceContextHash(mobileRoot, [...inventory.files, ...clientConfiguration, ...clientHarnessFiles]);
  const receipts = {
    node: readReceipt(join(root, 'coverage/mobile-contract-results-node.json')),
    postgres: readReceipt(join(root, 'coverage/mobile-contract-results-postgres.json')),
    'mobile-node': readReceipt(join(root, 'coverage/mobile-contract-results-mobile.json')),
    // Browser reports remain separate. Never infer a scenario pass from configured specs.
    playwright: undefined,
  };
  const errors: string[] = [];
  const ids = new Set<string>();
  const endpointForCallsite = (call: MobileApiCallsite): InventoryItem[] => endpoints.filter(endpoint =>
    endpoint.method === call.method && routeShape(endpoint.path!) === routeShape(call.path ?? ''));
  const operations = contracts.map(contract => {
    if (ids.has(contract.id)) errors.push(`Duplicate operation id: ${contract.id}`);
    ids.add(contract.id);
    const serverRoutes = contract.endpoints.map(id => {
      const endpoint = endpoints.find(item => item.id === id);
      if (!endpoint) errors.push(`${contract.id}: missing server endpoint ${id}`);
      return endpoint ? { id: endpoint.id, file: endpoint.file, line: endpoint.line } : null;
    }).filter((route): route is NonNullable<typeof route> => route !== null);
    for (const file of contract.mobileFiles) {
      if (!existsSync(join(mobileRoot, file))) errors.push(`${contract.id}: missing mobile source ${file}`);
    }
    const actionEvidence = (contract.actionEvidence ?? []).map(anchor => {
      const source = existsSync(join(mobileRoot, anchor.file)) ? readFileSync(join(mobileRoot, anchor.file), 'utf8') : '';
      const index = source.indexOf(anchor.sourceText);
      if (index < 0) errors.push(`${contract.id}: missing reviewed action anchor ${anchor.file}: ${anchor.sourceText}`);
      return { ...anchor, line: index < 0 ? null : source.slice(0, index).split('\n').length };
    });
    const callsites = inventory.callsites.filter(call => call.role === 'operation' && call.resolution === 'resolved' &&
      contract.mobileFiles.includes(call.file) && serverRoutes.some(route => endpointForCallsite(call).some(endpoint => endpoint.id === route.id)));
    if (contract.endpoints.length > 0 && callsites.length === 0) errors.push(`${contract.id}: no matching API callsite in its mobile source files`);
    const scenarios = contract.scenarios.map(scenario => {
      const evidence = scenarioEvidence(root, mobileRoot, scenario,
        scenario.mode === 'mobile-node' ? clientHash : backendHash, receipts[scenario.mode]);
      if (!evidence.valid) errors.push(`${contract.id}: ${evidence.error}`);
      return { ...scenario, evidence };
    });
    return { ...contract, serverRoutes, actionEvidence, callsiteReferences: callsites.map(call => ({ id: call.id, file: call.file,
      line: call.line, method: call.method, path: call.path, query: call.query })),
    scenarios, scenarioResult: scenarios.length === 0 ? 'no-reviewed-scenario' :
      scenarios.every(scenario => scenario.evidence.result === 'passed') ? 'reviewed-scenarios-passed' : 'partial-or-unexecuted',
    // A passing reviewed subset is deliberately not a complete-function certificate.
    completeBehaviorVerified: false };
  });
  const calls = inventory.callsites.map(call => {
    const matching = call.path ? endpointForCallsite(call) : [];
    const mapped = operations.filter(operation => operation.callsiteReferences.some(reference => reference.id === call.id)).map(operation => operation.id);
    if (call.role === 'operation' && (call.resolution !== 'resolved' || matching.length !== 1 || mapped.length === 0)) {
      errors.push(`Unmapped mobile operation callsite ${call.id}: ${call.method ?? '?'} ${call.path ?? call.rawExpression}`);
    }
    return { ...call, serverEndpoints: matching.map(endpoint => endpoint.id), operationIds: mapped };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    interpretation: 'Reviewed operation-to-assertion map. Runtime status comes only from matching named test-run events with unchanged source hashes. Shared endpoints may have several operation candidates; these are reviewed operation groupings, not automatic proof of each UI action or complete behavior.',
    sourceContext: { server: backendHash, mobile: clientHash },
    limitations: [...inventory.limitations,
      'A linked scenario proves only its stated assertions. Repository or transport-mock tests do not prove the whole HTTP-to-device journey.',
      'Native physical devices, real provider sign-in, R2/Cloudflare processing and push delivery require separate live evidence.',
      'All configured browser results stay in coverage/playwright-current.json; they are not silently promoted into fresh per-operation evidence.'],
    summary: {
      mobileSourceFiles: inventory.files.length,
      apiCallsites: calls.filter(call => call.role === 'operation').length,
      uniqueMobileEndpoints: new Set(calls.flatMap(call => call.serverEndpoints)).size,
      operations: operations.length,
      reviewedScenarioReferences: operations.reduce((sum, operation) => sum + operation.scenarios.length, 0),
      operationsWithAllReviewedScenariosPassed: operations.filter(operation => operation.scenarioResult === 'reviewed-scenarios-passed').length,
      externalTransportCallsites: calls.filter(call => call.resolution === 'external').length,
      genericTransportCallsites: calls.filter(call => call.role === 'transport' && call.resolution === 'unresolved').length,
      validationErrors: errors.length,
    },
    receipts: Object.fromEntries(Object.entries(receipts).map(([mode, receipt]) => [mode, receipt ? { createdAt: receipt.createdAt,
      sourceContextMatches: receipt.contextHash === (mode === 'mobile-node' ? clientHash : backendHash), summary: receipt.summary } : null])),
    validationErrors: errors,
    operations,
    callsites: calls,
  };
}
