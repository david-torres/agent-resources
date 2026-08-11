// Fourth test tier: real-browser coverage for behavior the unit (jsdom),
// http (mocked-model Express), and integration (Supabase, no browser) tiers
// structurally cannot reach — htmx swaps, Alpine's settle phase, boosted
// navigation, and the back button.
require('./util/env');
const { defineConfig, devices } = require('@playwright/test');

// Same guard the integration tier applies at scripts/run-tests.mjs:44-48.
// Pointing this suite at a cloud project would seed and delete rows there.
const supabaseUrl = process.env.SUPABASE_URL || '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(supabaseUrl)) {
  throw new Error(
    'E2E tests require local Supabase: set SUPABASE_URL=http://127.0.0.1:54321 ' +
    'after `supabase start`, then run `bun run seed:local`.'
  );
}

// 3100, not 3000: the developer's `bun run dev` owns 3000 and the suite must
// be runnable without stopping it.
const port = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/report/artifacts',
  globalSetup: require.resolve('./e2e/global-setup'),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/report/html', open: 'never' }]
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: `PORT=${port} bun run index.js`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
