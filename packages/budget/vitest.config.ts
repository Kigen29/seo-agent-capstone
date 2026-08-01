import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The RLS tests need a real Postgres, so they need DATABASE_URL. Loaded from the repo root
 * .env, which is gitignored. In CI the variable comes from the workflow environment and
 * this call finds no file and does nothing, which is the intended behaviour.
 */
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') })

export default defineConfig({
  test: {
    // A round trip to a hosted Postgres is slower than the unit suites elsewhere.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
