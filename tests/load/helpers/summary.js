export function handleSummary(data) {
  const file = __ENV.K6_REPORT_FILE || 'tests/load/reports/k6-summary.json';

  return {
    stdout: `${JSON.stringify(data.metrics, null, 2)}\n`,
    [file]: JSON.stringify(data, null, 2),
  };
}
