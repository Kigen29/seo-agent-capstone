import { assertTestDatabase } from '@seo/core'
import { defineConfig, devices } from '@playwright/test'
import { spawnSync } from 'node:child_process'

/**
 * Resolved from the working directory, not from `import.meta.url`. Playwright loads this
 * config through a CommonJS require (the web app has no `"type": "module"`), where
 * `import.meta` is a syntax error. Playwright always runs with the package as its cwd.
 */
assertTestDatabase(process.env)

const API_PORT = 4111
const WEB_PORT = 3111

/**
 * Fail here, loudly, rather than starting an API with an empty connection string and letting
 * it die somewhere less obvious. A misconfigured environment should say so in one line, not
 * present itself as seven mysteriously failing browser tests.
 */
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must explicitly point at the disposable local test database.')
}

/**
 * Is the database answering? Asked here, before anything is started.
 *
 * The local test database keeps its data in memory, so it is gone whenever Docker stops. The
 * suite then failed with "Process from config.webServer was not able to start", which is true
 * and says nothing: the API had died on a refused connection three layers down. This asks the
 * question directly and answers with the command that fixes it.
 *
 * In a child process, because this config is loaded synchronously and a socket is not. CI is
 * left alone: its database is a service the workflow starts and waits for.
 */
if (!process.env.CI) {
  const { hostname, port } = new URL(DATABASE_URL)
  const probe =
    'const s=require("node:net").connect(Number(process.argv[2]),process.argv[1]);' +
    's.setTimeout(3000);s.on("connect",()=>process.exit(0));' +
    's.on("error",()=>process.exit(1));s.on("timeout",()=>process.exit(1))'
  const answered = spawnSync(process.execPath, ['-e', probe, hostname, port || '5432'])

  if (answered.status !== 0) {
    throw new Error(
      `The test database at ${hostname}:${port} is not answering. It lives in Docker and keeps ` +
        'its data in memory, so it has to be started and migrated after every Docker restart. ' +
        'Start Docker Desktop, then run: pnpm test:db',
    )
  }
}

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

  // Browser startup has a separate allowance from measured production latency targets.
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
      url: `http://127.0.0.1:${API_PORT}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      // The limits stay on, so the suite runs against the server as deployed, and are widened
      // because fifty tests drive one account from one address as fast as a machine can click.
      env: { PORT: String(API_PORT), DATABASE_URL, RATE_LIMIT_SCALE: '100' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx next start -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
