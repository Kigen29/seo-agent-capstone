import { buildScorecard, type Finding } from '@seo/core'
import { apiTokens, asOwner, audits, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import { ruleCoverage } from '@seo/rules'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'

/**
 * A known tenant, token, site, audit, and findings, for the end-to-end test.
 *
 * Lives here rather than in `apps/web` because the web app is forbidden from importing
 * `@seo/db` (ADR-0009), and a test fixture is not an exemption from an architectural rule:
 * the moment the rule has exceptions it stops being enforceable. `@seo/audit` already knows
 * how to compose an audit and is allow-listed, so this is its natural home anyway.
 *
 * It writes rows directly rather than running a crawl. The crawl-to-database path is already
 * proven in this package against a real browser and a real server; repeating it would make
 * the UI test slow, dependent on a live site, and liable to fail for reasons that have
 * nothing to do with the UI. What the e2e is for is the screen.
 *
 * The scorecard, though, is built by the real `buildScorecard` with the real `ruleCoverage`,
 * so the four unmeasured axes are genuinely unmeasured rather than hand-written nulls that
 * could quietly drift from what the product actually produces. If the scorecard ever starts
 * lying about coverage, this fixture starts lying with it, and the e2e catches it.
 *
 * The ids are fixed so the test can navigate straight to a URL with no handoff.
 */
export const E2E = {
  tenant: 'e2e-tenant',
  otherTenant: 'e2e-other-tenant',
  token: 'seo_e2e_fixed_token_do_not_use_in_production',
  otherToken: 'seo_e2e_other_tenant_token_do_not_use',
  tenantId: '00000000-0000-4000-8000-000000000001',
  otherTenantId: '00000000-0000-4000-8000-000000000002',
  siteId: '00000000-0000-4000-8000-000000000003',
  auditId: '00000000-0000-4000-8000-000000000004',
  blockedFindingId: '00000000-0000-4000-8000-000000000005',
  canonicalFindingId: '00000000-0000-4000-8000-000000000006',
  siteUrl: 'https://seeded.example.com',
} as const

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex')

const draft = (over: Partial<Finding>): Finding => ({
  id: 'TECH-002#0',
  siteId: E2E.siteId,
  ruleId: 'TECH-002',
  axis: 'ai_visibility',
  severity: 'critical',
  confidence: 1,
  title: 'robots.txt blocks OAI-SearchBot, removing this site from AI answers',
  evidence: {
    kind: 'markup',
    observedAt: '2026-07-15T09:00:00.000Z',
    source: 'crawler',
    url: `${E2E.siteUrl}/robots.txt`,
    locator: '/robots.txt',
    snippet: 'User-agent: OAI-SearchBot\nDisallow: /',
  },
  affectedUrls: [`${E2E.siteUrl}/`],
  estimatedEffort: 'trivial',
  estimatedImpact: 95,
  falsification:
    'Re-fetch robots.txt and evaluate OAI-SearchBot against it. If the agent is allowed, this finding was wrong.',
  fixable: true,
  status: 'open',
  ...over,
})

export async function seedE2E(): Promise<void> {
  /**
   * The token above is a literal in a public repository, so it is public. That is fine in a
   * throwaway test database and catastrophic anywhere else: pointed at production, this
   * script would cheerfully create a tenant whose API token is printed on the internet.
   *
   * Nothing about `DATABASE_URL` tells us which kind of database we are looking at, and
   * guessing from the hostname would be exactly the sort of clever heuristic that is wrong
   * once and then very expensive. So it refuses to run unless somebody has said, out loud
   * and in the environment, that this database is disposable.
   */
  if (process.env.ALLOW_E2E_SEED !== '1') {
    throw new Error(
      'Refusing to seed. This writes a tenant whose API token is a public literal in the ' +
        'repo, which is safe only in a disposable test database. Set ALLOW_E2E_SEED=1 to ' +
        'confirm that DATABASE_URL points at one.',
    )
  }

  const { db, pool } = createDb()

  try {
    // Idempotent: the cascade takes the sites, audits, findings, and tokens with it.
    await asOwner(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, E2E.tenantId))
      await tx.delete(tenants).where(eq(tenants.id, E2E.otherTenantId))

      await tx.insert(tenants).values([
        { id: E2E.tenantId, name: E2E.tenant },
        { id: E2E.otherTenantId, name: E2E.otherTenant },
      ])

      await tx.insert(apiTokens).values([
        { tenantId: E2E.tenantId, name: 'e2e', tokenHash: hash(E2E.token) },
        { tenantId: E2E.otherTenantId, name: 'e2e', tokenHash: hash(E2E.otherToken) },
      ])
    })

    const drafts = [
      draft({}),
      draft({
        id: 'TECH-006#0',
        ruleId: 'TECH-006',
        axis: 'crawl_health',
        severity: 'low',
        title: `${E2E.siteUrl}/ has no canonical tag`,
        estimatedImpact: 25,
        estimatedEffort: 'small',
        falsification:
          'Re-fetch the page and look for link[rel="canonical"] in the rendered head. If one is present, this was wrong.',
      }),
    ]

    const scorecard = buildScorecard({
      siteId: E2E.siteId,
      findings: drafts,
      coverage: ruleCoverage(),
    })

    await withTenant(db, E2E.tenantId, async (tx) => {
      await tx.insert(sites).values({ id: E2E.siteId, tenantId: E2E.tenantId, url: E2E.siteUrl })

      await tx.insert(audits).values({
        id: E2E.auditId,
        tenantId: E2E.tenantId,
        siteId: E2E.siteId,
        status: 'complete',
        pagesCrawled: 12,
        completedAt: new Date(),
        scorecard,
      })

      await tx.insert(findings).values(
        drafts.map((d, i) => ({
          id: i === 0 ? E2E.blockedFindingId : E2E.canonicalFindingId,
          tenantId: E2E.tenantId,
          siteId: E2E.siteId,
          auditId: E2E.auditId,
          key: d.id,
          ruleId: d.ruleId,
          axis: d.axis,
          severity: d.severity,
          confidence: d.confidence,
          title: d.title,
          evidence: d.evidence,
          affectedUrls: d.affectedUrls,
          estimatedEffort: d.estimatedEffort,
          estimatedImpact: d.estimatedImpact,
          falsification: d.falsification,
          fixable: d.fixable,
          status: d.status,
        })),
      )
    })
  } finally {
    await pool.end()
  }
}
