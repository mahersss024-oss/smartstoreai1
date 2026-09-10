import { spawn } from 'node:child_process';

const minimumSupportedNodeMajor = 24;
const maximumSupportedNodeMajor = 26;

function getNodeMajorVersion() {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
}

function assertSupportedNodeVersion() {
  const nodeMajor = getNodeMajorVersion();

  if (
    Number.isFinite(nodeMajor) &&
    nodeMajor >= minimumSupportedNodeMajor &&
    nodeMajor <= maximumSupportedNodeMajor
  ) {
    return;
  }

  console.error(
    `[startup] Unsupported Node.js ${process.versions.node}. Use Node ${minimumSupportedNodeMajor}.x to ${maximumSupportedNodeMajor}.x.`,
  );
  process.exit(1);
}

function getMarketplaceStoreMode() {
  return (
    process.env.SMARTSTORE_MARKETPLACE_STORE?.trim().toLowerCase() || 'file'
  );
}

function assertProductionDatabaseStoreMode() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (getMarketplaceStoreMode() === 'database') {
    return;
  }

  console.error(
    '[startup] SMARTSTORE_MARKETPLACE_STORE must be "database" in production.',
  );
  process.exit(1);
}

assertSupportedNodeVersion();
assertProductionDatabaseStoreMode();

const port = process.env.PORT || '3000';

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', port],
  {
    env: process.env,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
