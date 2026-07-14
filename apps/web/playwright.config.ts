import { config } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

/**
 * Resolved from the working directory, not from `import.meta.url`. Playwright loads this
 * config through a CommonJS require (the web app has no `"type": "module"`), where
 * `import.meta` is a syntax error. Playwright always runs with the package as its cwd.
 */
config({ path: '../../.env' })

const API_PORT = 4111
const WEB_PORT = 3111

/**
 * The e2e runs the real web app against the real API against the real Postgres.
 *
 * Playwright starts both servers itself, so the test is one command and cannot pass because
 * somebody happened to have a stale server running with different code, which is exactly how
 * an e2e suite quietly stops meaning anything.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  /**
   * Generous, because the first authenticated request is genuinely slow and not because
   * anything is wrong.
   *
   * It opens the connection pool to Neon, which cold-starts, and that took well over
   * Playwright's five-second default. The first version of this suite therefore failed with
   * six red tests and a sign-in that worked perfectly: the assertion had simply given up
   * before the product had finished being correct. A test that is faster than the system it
   * tests does not measure the system, it measures the timeout.
   *
   * The same latency is what the ApiAsleep page exists for in production.
   */
  timeout: 60_000,
  expect: { timeout: 30_000 },

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    actionTimeout: 30_000,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /** Seeds the fixtures before anything starts. Idempotent, so a re-run is safe. */
  globalSetup: './e2e/global-setup.ts',

  webServer: [
    {
      command: 'node ../api/dist/server.js',
      port: API_PORT,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT), DATABASE_URL: process.env.DATABASE_URL ?? '' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx next start -p ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
