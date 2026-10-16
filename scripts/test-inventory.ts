import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildInventory } from './testing/inventory';

const inventory = buildInventory();
const counts = Object.fromEntries(['page', 'endpoint', 'function', 'control'].map(kind =>
  [kind, inventory.items.filter(item => item.kind === kind).length]));
mkdirSync('coverage', { recursive: true });
writeFileSync(join('coverage', 'inventory.json'), JSON.stringify({
  ...inventory,
  counts,
  interpretation: 'Inventory only. Discovery is not evidence of a passing behavioral test. Anonymous callbacks and reusable control definitions are included; dynamic runtime instances require browser tests.',
}, null, 2) + '\n');
console.log(JSON.stringify({ files: inventory.files.length, ...counts, report: 'coverage/inventory.json' }, null, 2));
