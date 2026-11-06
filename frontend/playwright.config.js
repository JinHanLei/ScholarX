import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 45000,
  use: { baseURL: process.env.EASYREF_TEST_URL || 'http://127.0.0.1:5001', viewport: { width: 1536, height: 960 }, screenshot: 'only-on-failure', launchOptions: process.env.EASYREF_BROWSER_EXECUTABLE ? { executablePath: process.env.EASYREF_BROWSER_EXECUTABLE } : {} },
  reporter: [['list']],
});
