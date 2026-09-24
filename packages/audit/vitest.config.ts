import { assertTestDatabase } from '../core/src/test-database'
import { defineConfig } from 'vitest/config'

// Integration tests mutate fixtures. Never accept a remote or unmarked database.
if (process.env.DATABASE_URL) assertTestDatabase(process.env)

export default defineConfig({
  test: {
    // A real Chromium plus disposable Postgres. Slower than the unit suites, and worth it.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
