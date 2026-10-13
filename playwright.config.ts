import { defineConfig, devices } from '@playwright/test';

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '3102', 10);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  globalTimeout: process.env.CI ? 300_000 : 180_000,
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
        command: 'pnpm build && pnpm start',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          AUTH_SECRET:
            process.env.AUTH_SECRET ?? 'development-only-smartstore-auth-secret',
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'e2e-placeholder',
          NODE_ENV: 'test',
          PORT: String(port),
          SMARTSTORE_IMAGE_STORAGE: process.env.SMARTSTORE_IMAGE_STORAGE ?? '',
          SMARTSTORE_MARKETPLACE_STORE:
            process.env.SMARTSTORE_MARKETPLACE_STORE ?? 'file',
        },
      },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium-layout',
      use: { ...devices['Pixel 5'], browserName: 'chromium' },
    },
  ],
});
