import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.K6_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;

if (!baseURL) {
  throw new Error('Set K6_BASE_URL or PLAYWRIGHT_BASE_URL before running browser load checks.');
}

export default defineConfig({
  testDir: '.',
  outputDir: '../../../coverage/browser-load-artifacts',
  timeout: 60_000,
  globalTimeout: 180_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'], browserName: 'chromium' },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
