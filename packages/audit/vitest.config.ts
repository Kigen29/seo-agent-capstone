import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The audit tests drive a real browser against a real server and store to a real Postgres,
 * so they need DATABASE_URL. Loaded from the gitignored root .env. In CI the variable comes
 * from the workflow environment and this call finds no file, which is intended.
 */
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') })

export default defineConfig({
  test: {
    // A real Chromium plus a hosted Postgres. Slower than the unit suites, and worth it.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
