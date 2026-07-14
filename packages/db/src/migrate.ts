import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createDb } from './client.js'

/**
 * Applies every pending migration, then exits. Run by `pnpm --filter @seo/db db:migrate`,
 * and by CI against a scratch database before the integration tests.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  const { db, pool } = createDb(connectionString)
  const here = dirname(fileURLToPath(import.meta.url))

  try {
    await migrate(db, { migrationsFolder: resolve(here, '../migrations') })
  } finally {
    await pool.end()
  }
}

/**
 * Run only when invoked directly, not when imported.
 *
 * Compared via pathToFileURL rather than by string-building `file://${argv[1]}`, which is
 * what this originally did and which silently never matched on Windows: the repo path
 * contains spaces, `import.meta.url` percent-encodes them, and the hand-built string does
 * not. The guard was simply always false, so `db:migrate` exited 0 having done nothing,
 * which is the worst possible way for a migration runner to fail.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrations()
  console.log('migrations applied')
}
