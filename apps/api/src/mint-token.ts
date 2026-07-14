import { apiTokens, asOwner, createDb, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import { generateToken, hashToken } from './auth.js'

/**
 * Mint an API token for a tenant, creating the tenant if it does not exist.
 *
 *   pnpm --filter @seo/api mint-token <tenant-name> [token-name]
 *
 * Prints the token once. It is not recoverable: we store only its SHA-256, so we are
 * incapable of showing it again even if asked. That is the point.
 *
 * Runs through `asOwner`, like every operation that logically precedes a tenant context.
 */
const [tenantName, tokenName = 'cli'] = process.argv.slice(2)

if (!tenantName) {
  console.error('usage: mint-token <tenant-name> [token-name]')
  process.exit(1)
}

const { db, pool } = createDb()

try {
  const token = generateToken()

  const tenantId = await asOwner(db, async (tx) => {
    const [existing] = await tx.select().from(tenants).where(eq(tenants.name, tenantName)).limit(1)

    const id =
      existing?.id ?? (await tx.insert(tenants).values({ name: tenantName }).returning())[0]?.id

    if (!id) throw new Error('Could not create the tenant.')

    await tx
      .insert(apiTokens)
      .values({ tenantId: id, name: tokenName, tokenHash: hashToken(token) })

    return id
  })

  console.log(`\n  tenant  ${tenantName} (${tenantId})`)
  console.log(`  token   ${token}`)
  console.log('\n  Store it now. It is hashed at rest and cannot be shown again.\n')
} finally {
  await pool.end()
}
