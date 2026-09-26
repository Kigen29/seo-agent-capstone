import { apiTokens, asOwner, createDb, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import { generateToken, hashToken } from './auth.js'

/**
 * Mint an API token for a tenant, creating the tenant if it does not exist.
 *
 *   pnpm --filter @seo/api mint-token <tenant-name> [token-name] [expires-in-days]
 *
 * Prints the token once. It is not recoverable: we store only its SHA-256, so we are
 * incapable of showing it again even if asked. That is the point.
 *
 * Runs through `asOwner`, like every operation that logically precedes a tenant context.
 */
const [tenantName, tokenName = 'cli', expiryArg] = process.argv.slice(2)
const expiryDays = expiryArg === undefined ? undefined : Number(expiryArg)

if (
  !tenantName ||
  (expiryDays !== undefined &&
    (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 3650))
) {
  console.error('usage: mint-token <tenant-name> [token-name] [expires-in-days, 1 to 3650]')
  process.exit(1)
}

// No expiry by default, matching every token minted before expiry existed. Revocation still works.
const expiresAt =
  expiryDays === undefined ? null : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)

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
      .values({ tenantId: id, name: tokenName, tokenHash: hashToken(token), expiresAt })

    return id
  })

  console.log(`\n  tenant  ${tenantName} (${tenantId})`)
  console.log(`  token   ${token}`)
  console.log(`  expires ${expiresAt ? expiresAt.toISOString() : 'never (revoke it to stop it)'}`)
  console.log('\n  Store it now. It is hashed at rest and cannot be shown again.\n')
} finally {
  await pool.end()
}
