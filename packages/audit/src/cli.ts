import { asOwner, createDb, sites, tenants, withTenant } from '@seo/db'
import { and, eq } from 'drizzle-orm'
import { runAudit } from './run.js'

/**
 * Run one audit, end to end, against a real site and a real database.
 *
 *   pnpm --filter @seo/audit audit:run https://example.com [tenant-name] [maxPages]
 *
 * This is the worker's entry point in everything but name (ADR-0006: the job runs on a
 * GitHub Actions runner, which has Chromium preinstalled). It is also how the audit is
 * demonstrated, which is the point: the demo path and the production path are the same code.
 */
const [seed, tenantName = 'demo', maxPages = '25'] = process.argv.slice(2)

if (!seed) {
  console.error('usage: audit:run <url> [tenant-name] [max-pages]')
  process.exit(1)
}

const { db, pool } = createDb()

try {
  // Onboarding. The one operation that cannot run as a tenant, because at this moment the
  // tenant does not exist: there is no id to scope by and no policy that could pass. This is
  // the narrow, deliberate use of `asOwner`. See ADR-0008.
  const tenantId = await asOwner(db, async (tx) => {
    const [existing] = await tx.select().from(tenants).where(eq(tenants.name, tenantName)).limit(1)
    if (existing) return existing.id

    const [created] = await tx.insert(tenants).values({ name: tenantName }).returning()
    if (!created) throw new Error('Could not create the tenant.')
    return created.id
  })

  const siteId = await withTenant(db, tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.url, seed)))
      .limit(1)
    if (existing) return existing.id

    const [created] = await tx.insert(sites).values({ tenantId, url: seed }).returning()
    if (!created) throw new Error('Could not create the site.')
    return created.id
  })

  console.log(`\n  auditing ${seed}  (tenant "${tenantName}", up to ${maxPages} pages)\n`)

  const result = await runAudit(db, {
    tenantId,
    siteId,
    seed,
    maxPages: Number(maxPages),
    onProgress: (n) => process.stdout.write(`\r  crawled ${n} pages`),
  })

  const label = { good: 'GOOD', needs_work: 'NEEDS WORK', poor: 'POOR', not_measured: '--' }

  console.log(`\n\n  ${result.pagesCrawled} pages, ${result.findings.length} findings\n`)

  for (const axis of result.scorecard.axes) {
    const score = axis.score === null ? '   -' : String(Math.round(axis.score)).padStart(4)
    console.log(
      `  ${axis.axis.padEnd(16)}${score}  ${label[axis.status].padEnd(11)}${axis.coverage.checksRun} checks`,
    )
  }

  console.log(`\n  audit ${result.auditId}`)
  console.log(`  totals ${JSON.stringify(result.scorecard.totals)}`)
  console.log(`  look at first: ${result.scorecard.worstAxes.join(', ') || '(nothing)'}\n`)
} finally {
  await pool.end()
}
