import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import { buildInventory } from './testing/inventory';
import { buildCoverageEvidence } from './testing/coverage-evidence';

const inventory = buildInventory();
const evidence = buildCoverageEvidence(process.cwd(), inventory.items);
const measurement = JSON.parse(readFileSync('coverage/unit-summary.json', 'utf8')) as {
  scope: string;
  tests?: Record<string, number>;
  files: Array<{ path: string }>;
  totals: Record<string, number>;
};
const measuredFiles = new Set(measurement.files.map(file => relative(process.cwd(), file.path).replaceAll('\\', '/')));
const neverLoaded = inventory.files.filter(file => !measuredFiles.has(file));
const report = {
  interpretation: 'Evidence and gaps only. Module imports and configured test baselines do not prove individual behavior passed. No source item is marked fully behavior-covered.',
  sourceFiles: inventory.files.length,
  nodeMeasuredFiles: inventory.files.filter(file => measuredFiles.has(file)).length,
  neverLoadedByNodeTests: neverLoaded,
  nativeRuntimeMeasurement: { scope: measurement.scope, totals: measurement.totals, tests: measurement.tests },
  evidenceMap: 'coverage/evidence-map.json',
  testFileReferences: evidence.sourceModuleReferenceSummary,
  endpoints: evidence.endpoints,
  pages: evidence.pages,
  controls: evidence.controls,
  e2eProjects: evidence.testFiles.e2e,
  functionsInFilesNotLoadedByNodeTests: inventory.items.filter(item => item.kind === 'function' && !measuredFiles.has(item.file)),
  externalGaps: [
    'Real Google/Apple login and callback exchange with provider credentials',
    'Real AI provider responses, outages and quotas',
    'Real object storage uploads, deletion and CDN delivery',
    'Real push delivery and native mobile deep links',
    'Database-backed successful admin/moderator workflows and all permission combinations',
    'Physical devices, networks, production load and long-running resilience',
  ],
};
mkdirSync('coverage', { recursive: true });
writeFileSync('coverage/evidence-map.json', JSON.stringify(evidence, null, 2) + '\n');
writeFileSync('coverage/gaps.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  sourceFiles: report.sourceFiles,
  nodeMeasuredFiles: report.nodeMeasuredFiles,
  neverLoadedByNodeTests: neverLoaded.length,
  directEndpointHandlerReferences: evidence.sourceModuleReferenceSummary.endpointsWithDirectHandlerImportReference,
  controls: evidence.controls.length,
  report: 'coverage/gaps.json',
  evidenceMap: 'coverage/evidence-map.json',
}, null, 2));
