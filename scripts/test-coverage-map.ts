import { mkdirSync, writeFileSync } from 'node:fs';

import { buildInventory } from './testing/inventory';
import { buildCoverageEvidence } from './testing/coverage-evidence';

const inventory = buildInventory();
const evidence = buildCoverageEvidence(process.cwd(), inventory.items);
mkdirSync('coverage', { recursive: true });
writeFileSync('coverage/evidence-map.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  sourceItems: inventory.items.length,
  nodeTestFiles: evidence.testFiles.node.length,
  e2eTestFiles: evidence.testFiles.e2e.length,
  endpoints: evidence.endpoints.length,
  endpointMethodsWithDirectTestImports: evidence.sourceModuleReferenceSummary.endpointsWithDirectHandlerImportReference,
  pages: evidence.pages.length,
  controls: evidence.controls.length,
  report: 'coverage/evidence-map.json',
  interpretation: 'References and configured baselines only; this command does not execute tests or certify full behavior coverage.',
}, null, 2));
