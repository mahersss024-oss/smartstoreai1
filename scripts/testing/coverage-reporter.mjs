// Keep the native runtime measurements separate from the source inventory.
export default async function* coverageReporter(events) {
  let summary;
  const tests = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for await (const event of events) {
    if (event.type === 'test:pass') {
      tests[event.data.skip ? 'skipped' : event.data.todo ? 'todo' : 'passed']++;
    }
    if (event.type === 'test:fail') tests.failed++;
    if (event.type === 'test:coverage') {
      summary = event.data.summary;
    }
  }
  if (summary) yield JSON.stringify({
    scope: 'Node tests only. Unexecuted modules and browser coverage are excluded. Transpiler-generated helpers may affect native function/branch counts; these are not percentages of all source inventory items.',
    tests,
    ...summary,
  }, null, 2) + '\n';
}
