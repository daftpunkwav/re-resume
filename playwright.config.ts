/**
 * @file playwright.config
 * @description The end-to-end harness. Every spec drives the real interface
 * against the browser preview assembly (`?preview`), which answers the same
 * capabilities as the desktop window over memory instead of SQLite: the flows
 * here exercise the presentation and application layers without a native shell.
 *
 * Constraints:
 * - The preview entry is development-only, so the web server runs Vite in
 *   development mode explicitly; a production build has no `?preview` route.
 * - No network dependency: the preview's provider is scripted, and fonts and
 *   fixtures are local files.
 * - Waits are web-first assertions only; fixed sleeps hide flakiness.
 */

import { defineConfig, devices } from '@playwright/test'

const PORT = 1445
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // A retry in CI covers a slow first paint of the preview bundle; a real
  // failure still fails both attempts.
  retries: process.env.CI === undefined ? 0 : 1,
  workers: process.env.CI === undefined ? undefined : 2,
  forbidOnly: process.env.CI !== undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 840 },
    colorScheme: 'light',
    trace: 'on-first-retry',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 840 } },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
    env: { NODE_ENV: 'development' },
  },
})
