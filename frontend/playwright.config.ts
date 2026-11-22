import { defineConfig } from '@playwright/test';

const firefox = process.env.PLAYWRIGHT_BROWSER === 'firefox';

const config = defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4217',
    browserName: firefox ? 'firefox' : 'chromium',
    headless: true,
    launchOptions: {
      ...((firefox ? process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
        ? {
            executablePath: firefox
              ? process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE
              : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          }
        : {}),
      args: firefox ? [] : ['--no-sandbox']
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
