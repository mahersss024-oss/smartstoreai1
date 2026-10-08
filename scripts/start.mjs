import { spawn } from 'node:child_process';

const minimumSupportedNodeMajor = 22;
const maximumSupportedNodeMajor = 24;

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

function shouldRunDatabaseMigrations() {
  const value = process.env.SMARTSTORE_RUN_DB_MIGRATIONS_ON_START?.trim();
  return value === '1' || value?.toLowerCase() === 'true';
}

function runDatabaseMigrations() {
  return new Promise((resolve, reject) => {
    const prismaBin =
      process.platform === 'win32'
        ? 'node_modules\\.bin\\prisma.cmd'
        : 'node_modules/.bin/prisma';
    const migration = spawn(prismaBin, ['migrate', 'deploy'], {
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    migration.on('error', reject);
    migration.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `[startup] prisma migrate deploy exited with signal ${signal}.`
            : `[startup] prisma migrate deploy exited with code ${code}.`,
        ),
      );
    });
  });
}

assertSupportedNodeVersion();
assertProductionDatabaseStoreMode();

if (shouldRunDatabaseMigrations()) {
  console.log('[startup] applying database migrations...');
  await runDatabaseMigrations();
}

const port = process.env.PORT || '3000';
const shutdownGraceMs = Number.parseInt(
  process.env.SMARTSTORE_SHUTDOWN_GRACE_MS ?? '',
  10,
);
const gracefulShutdownMs = Number.isFinite(shutdownGraceMs)
  ? Math.max(0, shutdownGraceMs)
  : 10_000;

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', port],
  {
    env: process.env,
    stdio: 'inherit',
  },
);

let shuttingDown = false;

function forwardSignal(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[startup] received ${signal}, shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[startup] graceful shutdown timed out, forcing exit.');
    child.kill('SIGKILL');
  }, gracefulShutdownMs);

  forceExitTimer.unref?.();

  child.once('exit', () => clearTimeout(forceExitTimer));
  child.kill(signal);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => forwardSignal(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
