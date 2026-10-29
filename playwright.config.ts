import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '3102', 10);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const serverReadyUrl = new URL('/api/health', baseURL).toString();
const testDataDir = process.env.PLAYWRIGHT_BASE_URL
  ? undefined : mkdtempSync(join(tmpdir(), 'smartstore-e2e-'));

// Customer journeys run in the native applications. Browser coverage is for
// the app gateway, public policies and administration UI; API contracts need no browser.
const adminBrowserSpecs = [
  '**/app-download-gateway.spec.ts',
  '**/legal-pages.spec.ts',
  '**/admin-page-presentation.spec.ts',
  '**/admin-users-loading.spec.ts',
  '**/admin-workspace.spec.ts',
  '**/all-pages-vitals.spec.ts',
  '**/customer-evidence.spec.ts',
  '**/marketplace-car-models.spec.ts',
  '**/marketplace-categories.spec.ts',
  '**/performance-stability.spec.ts',
  '**/route-contracts.spec.ts',
];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Allow the admin layout matrix and server contracts to finish without weakening per-test budgets.
  globalTimeout: 1_800_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm exec tsx e2e/prepare-fixtures.ts && pnpm build && pnpm start',
        // Server readiness must not depend on a customer-facing landing page.
        // Probe the health API so Playwright can detect the server after startup.
        url: serverReadyUrl,
        reuseExistingServer: false,
        // This budget includes a complete production build on a cold machine.
        // Individual test and assertion timeouts remain unchanged.
        timeout: 300_000,
        env: {
          // A real configured owner is required by the server-rendered maintenance layout.
          SMARTSTORE_ADMIN_EMAILS: 'browser-owner@example.test',
          AUTH_SECRET:
            process.env.AUTH_SECRET ?? 'development-only-smartstore-auth-secret',
          // Keep Next's env loader and the provider's local-env preference away from real credentials.
          CI: '1',
          DEEPSEEK_API_KEY: 'test-model-placeholder',
          NODE_OPTIONS: [process.env.NODE_OPTIONS,
            `--import=${pathToFileURL(resolve('scripts/testing/isolated-model-provider.mjs')).href}`,
          ].filter(Boolean).join(' '),
          NODE_ENV: 'test',
          PORT: String(port),
          NEXT_PUBLIC_APP_URL: baseURL,
          // Exercise the unpublished state without inheriting real store links.
          NEXT_PUBLIC_ANDROID_APP_STORE_URL: '',
          NEXT_PUBLIC_IOS_APP_STORE_URL: '',
          SMARTSTORE_DATA_DIR: testDataDir!,
          SMARTSTORE_IMAGE_STORAGE: process.env.SMARTSTORE_IMAGE_STORAGE ?? '',
          SMARTSTORE_MARKETPLACE_STORE:
            process.env.SMARTSTORE_MARKETPLACE_STORE ?? 'file',
        },
      },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: adminBrowserSpecs,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium-layout',
      testMatch: adminBrowserSpecs,
      use: { ...devices['Pixel 5'], browserName: 'chromium' },
    },
    {
      name: 'api-contracts',
      testMatch: ['**/api-contracts.spec.ts', '**/listing-reference.spec.ts'],
    },
  ],
});
