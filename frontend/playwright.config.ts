import { defineConfig } from '@playwright/test';
const config = defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4217',
    headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      args: ['--no-sandbox']
    },
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node ../scripts/frontend-test-server.mjs',
    url: 'http://127.0.0.1:4217/bootstrap',
    reuseExistingServer: false,
    timeout: 30000
  }
});

export default config;
