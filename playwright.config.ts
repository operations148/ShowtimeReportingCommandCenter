import { defineConfig, devices } from '@playwright/test';

/**
 * TEST-ONLY browser QA configuration.
 *
 * VITE_TASK_MANAGEMENT_ENABLED is set HERE and only here, so the Task Management tab is
 * visible to browser tests without ever being enabled in .env.local, in Vercel, or in any
 * production build. The server-side TASK_MANAGEMENT_ENABLED flag is untouched and irrelevant
 * to these tests, because every /api/** request is intercepted in-browser and answered from
 * e2e/fixtures.ts — no browser test can reach the production Task API.
 *
 * The dev server is plain `vite` (static asset serving only). server.ts is deliberately not
 * used, so nothing here depends on or modifies it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './e2e/.artifacts',
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    // The app registers a service worker. A controlled page routes fetches through the SW,
    // which bypasses page.route() — making interception non-deterministic and, worse,
    // allowing a request to escape the harness. Blocking service workers keeps every
    // request interceptable. The SW's own behaviour is covered by its existing tests.
    serviceWorkers: 'block'
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet',  use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'mobile',  use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false } }
  ],

  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199/index.html',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Test-only. Never written to .env.local or any deployment environment.
      VITE_TASK_MANAGEMENT_ENABLED: 'true'
    }
  }
});
