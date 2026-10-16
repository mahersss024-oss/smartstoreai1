import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import { buildInventory } from './testing/inventory';
import { routeContract } from './testing/route-contracts';

const inventory = buildInventory();
const measurement = JSON.parse(readFileSync('coverage/unit-summary.json', 'utf8')) as {
  scope: string;
  files: Array<{ path: string }>;
  totals: Record<string, number>;
};
const measuredFiles = new Set(measurement.files.map(file => relative(process.cwd(), file.path).replaceAll('\\', '/')));
const neverLoaded = inventory.files.filter(file => !measuredFiles.has(file));
const report = {
  interpretation: 'A passing baseline is not complete behavioral coverage. Never-loaded files are NOT covered by Node tests. Existing browser tests may exercise them separately. Every discovered control still needs an explicit behavior-to-test mapping before claiming complete button coverage.',
  sourceFiles: inventory.files.length,
  nodeMeasuredFiles: inventory.files.filter(file => measuredFiles.has(file)).length,
  neverLoadedByNodeTests: neverLoaded,
  nativeRuntimeMeasurement: { scope: measurement.scope, totals: measurement.totals },
  endpoints: inventory.items.filter(item => item.kind === 'endpoint').map(endpoint => ({
    id: endpoint.id,
    file: endpoint.file,
    accessContract: routeContract(endpoint) ?? 'unclassified',
    baselineTests: [
      'e2e/route-contracts.spec.ts: HTTP method routing',
      ...(routeContract(endpoint) === 'guest' ? [] : [
        'tests/route-access-contracts.test.ts: invalid sessions',
        'e2e/route-contracts.spec.ts: HTTP access restrictions',
      ]),
    ],
    completeBehaviorVerified: false,
  })),
  pages: inventory.items.filter(item => item.kind === 'page').map(page => ({
    path: page.path,
    file: page.file,
    baselineTest: 'e2e/route-contracts.spec.ts: guest/customer rendering',
    completeBehaviorVerified: false,
  })),
  controlsRequiringExplicitBehaviorMapping: inventory.items.filter(item => item.kind === 'control'),
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
writeFileSync('coverage/gaps.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  sourceFiles: report.sourceFiles,
  nodeMeasuredFiles: report.nodeMeasuredFiles,
  neverLoadedByNodeTests: neverLoaded.length,
  controlsRequiringExplicitBehaviorMapping: report.controlsRequiringExplicitBehaviorMapping.length,
  report: 'coverage/gaps.json',
}, null, 2));
