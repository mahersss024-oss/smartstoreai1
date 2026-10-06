#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const scenario = process.argv[2];

if (!scenario || process.argv.includes('--help')) {
  console.log('Usage: node tests/load/scripts/run-k6.mjs <scenario.js> [-- <k6 args>]');
  process.exit(scenario ? 0 : 1);
}

const passthroughIndex = process.argv.indexOf('--');
const passthroughArgs =
  passthroughIndex === -1 ? [] : process.argv.slice(passthroughIndex + 1);
const scenarioPath = resolve(process.cwd(), scenario);
const reportDir = resolve(process.cwd(), 'tests/load/reports');
mkdirSync(reportDir, { recursive: true });

const reportName = `${basename(scenario, '.js')}-${new Date()
  .toISOString()
  .replace(/[:.]/g, '-')}.json`;
const env = {
  ...process.env,
  K6_REPORT_FILE: process.env.K6_REPORT_FILE || `tests/load/reports/${reportName}`,
};

const result = spawnSync('k6', ['run', scenarioPath, ...passthroughArgs], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error?.code === 'ENOENT') {
  console.error('k6 is not installed or is not available on PATH.');
  console.error('Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/.');
  process.exit(1);
}

process.exit(result.status ?? 1);
