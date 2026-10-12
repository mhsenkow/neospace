import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT || 4173)
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`

/**
 * Mobile journeys live in `*.mobile.spec.ts` and run in a Chromium mobile project
 * (Pixel 7: touch, mobile viewport) so CI needs only the Chromium install.
 * WebKit (`iPhone 13`) stays opt-in — `E2E_WEBKIT=1 npx playwright install webkit` first —
 * so a missing WebKit binary is a setup problem, never a product failure.
 */
const MOBILE_SPEC = /.*\.mobile\.spec\.ts/

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // CI: annotations in the PR plus a browsable report (traces open from it)
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL,
    // CI keeps a trace for every failure (not only retries) so a one-off flake is still debuggable
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: MOBILE_SPEC,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: MOBILE_SPEC,
      use: { ...devices['Pixel 7'] },
    },
    ...(process.env.E2E_WEBKIT
      ? [
          {
            name: 'mobile-webkit',
            testMatch: MOBILE_SPEC,
            use: { ...devices['iPhone 13'] },
          },
        ]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Repo-owned static server over `npm run generate` output — no download at test time
        command: 'node scripts/serve-e2e.mjs',
        env: { E2E_PORT: String(port) },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
