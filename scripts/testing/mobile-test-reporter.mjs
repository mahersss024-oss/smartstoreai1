import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

// Results come from Node test runner events, never from the source inventory.
export default async function* mobileTestReporter(events) {
  const tests = [];
  const summary = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for await (const event of events) {
    if (!['test:pass', 'test:fail'].includes(event.type)) continue;
    const data = event.data;
    const status = data.skip ? 'skipped' : data.todo ? 'todo' : event.type === 'test:pass' ? 'passed' : 'failed';
    summary[status]++;
    let sourceHash = null;
    try { if (data.file) sourceHash = createHash('sha256').update(readFileSync(data.file)).digest('hex'); } catch { /* File-less runner events remain explicitly unbound. */ }
    tests.push({
      file: data.file ? relative(process.cwd(), data.file).replaceAll('\\', '/') : null,
      name: data.name,
      line: data.line ?? null,
      nesting: data.nesting ?? 0,
      status,
      sourceHash,
      reason: typeof data.skip === 'string' ? data.skip : undefined,
    });
  }
  yield JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(),
    contextHash: process.env.SMARTSTORE_CONTRACT_CONTEXT_HASH ?? null, summary, tests }, null, 2) + '\n';
}
