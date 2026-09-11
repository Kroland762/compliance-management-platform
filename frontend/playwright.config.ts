import { defineConfig, devices } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3001';
const appBase = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const reuseExistingServer = !process.env.CI && process.env.E2E_REUSE_SERVER !== 'false';

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.E2E_OUTPUT_DIR || 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: appBase,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm start',
      cwd: '../backend',
      env: { PORT: new URL(apiBase).port || '3001', FRONTEND_URL: appBase },
      url: `${apiBase}/api/health/ready`,
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${new URL(appBase).port || '4173'}`,
      cwd: '.',
      env: { VITE_API_PROXY_TARGET: apiBase },
      url: appBase,
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
});
