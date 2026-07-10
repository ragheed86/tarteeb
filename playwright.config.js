// إعداد Playwright — يشغّل خادم التطوير تلقائياً ويعيد استخدامه إن كان يعمل
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 0,
  globalSetup: require.resolve('./tests/auth.setup.js'),
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:3002',
    storageState: 'playwright/.auth/user.json',
    locale: 'ar-SA',
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run dev -- -p 3002',
    port: 3002,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
