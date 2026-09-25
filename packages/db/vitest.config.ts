import { assertTestDatabase } from '../core/src/test-database'
import { defineConfig } from 'vitest/config'

// Integration tests mutate fixtures. Never accept a remote or unmarked database.
if (process.env.DATABASE_URL) assertTestDatabase(process.env)

export default defineConfig({
  test: {
    // Allow for database container startup and transaction contention.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
