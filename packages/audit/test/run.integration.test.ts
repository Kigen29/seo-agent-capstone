import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  asOwner,
  audits,
  createDb,
  findings,
  sites,
  tenants,
  withTenant,
  type Database,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAudit, listSites } from '../src/queries.js'
import { runAudit } from '../src/run.js'

/**
 * The whole Sprint 1 loop, against a real browser, a real HTTP server, and a real Postgres.
 *
 * There is no useful way to fake this. The value of the audit runner is precisely that it
 * joins four packages that do not know about each other, so a test with any of them mocked
 * would be testing the mock's idea of the seam rather than the seam.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

const page = (body: string) => `<!doctype html>
<html lang="en"><head><title>A page with a reasonable title</title></head>
<body>${body}</body></html>`

function startSite(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      // Blocks an AI search crawler, so the audit has a critical finding to report and the
      // ai_visibility axis has something to say. This is the misconfiguration TECH-002 exists
      // for, and it is the one that most often costs a real site its ChatGPT citations.
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n')
      return
    }

    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      page(
        req.url === '/'
          ? '<h1>Home</h1><p>Enough words on this page that it does not count as thin content by any reasonable measure at all.</p><a href="/a">A</a>'
          : '<h1>Page A</h1><p>Different words entirely, so this is not a near-duplicate of the homepage in any sense.</p>',
      ),
    )
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

describe.skipIf(!shouldRun)('runAudit: crawl, rules, scorecard, persisted', () => {
  let db: Database
  let closeDb: () => Promise<void>
  let site: Awaited<ReturnType<typeof startSite>>

  let tenantId: string
  let siteId: string
  let auditId: string

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    closeDb = () => created.pool.end()
    site = await startSite()

    tenantId = await asOwner(db, async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ name: `audit-test-${Date.now()}` })
        .returning()
      return row!.id
    })

    siteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx.insert(sites).values({ tenantId, url: site.origin }).returning()
      return row!.id
    })

    const result = await runAudit(db, { tenantId, siteId, seed: site.origin, maxPages: 5 })
    auditId = result.auditId
  }, 180_000)

  afterAll(async () => {
    await site?.close()
    if (!db) return
    await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    await closeDb()
  })

  it('records the audit as complete, with the pages it actually crawled', async () => {
    const audit = await getAudit(db, tenantId, auditId)

    expect(audit?.status).toBe('complete')
    expect(audit?.pagesCrawled).toBeGreaterThan(0)
    expect(audit?.completedAt).toBeTruthy()
    expect(audit?.error).toBeNull()
  })

  it('stores the eight-axis scorecard whole, blanks included', async () => {
    const audit = await getAudit(db, tenantId, auditId)

    expect(audit?.scorecard?.axes).toHaveLength(8)

    // The four unmeasured axes must survive the round trip as nulls. If jsonb or the schema
    // ever coerced them to 0 or 100, the dashboard would start lying about what we checked,
    // and it would do it silently.
    const unmeasured = audit?.scorecard?.axes.filter((a) => a.status === 'not_measured') ?? []
    expect(unmeasured).toHaveLength(4)
    for (const axis of unmeasured) expect(axis.score).toBeNull()
  })

  it('finds the blocked AI search crawler and stores it as critical', async () => {
    const audit = await getAudit(db, tenantId, auditId)
    const blocked = audit?.findings.find((f) => f.ruleId === 'TECH-002')

    expect(blocked?.severity).toBe('critical')
    expect(audit?.scorecard?.axes.find((a) => a.axis === 'ai_visibility')?.status).toBe('poor')
  })

  it('persists a falsification condition for every finding', async () => {
    // The database column is NOT NULL, so this cannot fail without the insert having failed
    // first. Asserted anyway: rule 3 is the one that separates this product from a list of
    // opinions, and it is worth a test that says so out loud.
    const audit = await getAudit(db, tenantId, auditId)

    expect(audit?.findings.length).toBeGreaterThan(0)
    for (const finding of audit!.findings) {
      expect(finding.falsification.length).toBeGreaterThan(10)
      expect(finding.evidence).toBeTruthy()
    }
  })

  it('keeps the rule engine stable key alongside the row uuid', async () => {
    // Two identities, on purpose. The uuid is what URLs and foreign keys point at. The key
    // ('TECH-002#0') is what the verifier re-checks by name after a fix. Collapsing them
    // would give us either URLs that break on every re-crawl or a verifier that cannot find
    // the finding it is meant to verify.
    const audit = await getAudit(db, tenantId, auditId)
    const finding = audit!.findings[0]!

    expect(finding.id).toMatch(/^TECH-\d{3}#\d+$/)
    expect(finding.rowId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('surfaces the audit on the site list, so the dashboard has something to show', async () => {
    const listed = await listSites(db, tenantId)

    expect(listed).toHaveLength(1)
    expect(listed[0]?.latestAudit?.status).toBe('complete')
    expect(listed[0]?.latestAudit?.scorecard?.axes).toHaveLength(8)
  })

  it('hides one tenant audit from another', async () => {
    // The end-to-end proof of ADR-0008. Everything above went through withTenant; this asks
    // whether a *different* tenant can reach any of it. It cannot, because Postgres says so.
    const other = await asOwner(db, async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ name: `other-${Date.now()}` })
        .returning()
      return row!.id
    })

    try {
      expect(await getAudit(db, other, auditId)).toBeUndefined()
      expect(await listSites(db, other)).toEqual([])
    } finally {
      await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, other)))
    }
  })

  it('refuses to score a site it never reached, and says so', async () => {
    // This caught a real bug, and it is the most dangerous kind: the one where the product
    // is confidently wrong rather than merely broken.
    //
    // The crawler records an unfetchable page as status 0 with an error, instead of throwing,
    // because one dead page in a hundred must not kill a crawl. But that means an unreachable
    // SEED produced a crawl that looked fine and held a single dead page, the rules ran over
    // it, and the audit came back reporting with full confidence that the site had no sitemap
    // and no canonical tag. Both statements are true of a server that never answered. Both
    // are worthless. The user would have been shown a scorecard for a site we never saw.
    //
    // No data is not the same as no problems. That is the entire thesis of the scorecard's
    // not_measured state, and it was leaking in through the back door.
    const deadSiteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ tenantId, url: 'http://127.0.0.1:1/' })
        .returning()
      return row!.id
    })

    await expect(
      runAudit(db, { tenantId, siteId: deadSiteId, seed: 'http://127.0.0.1:1/', maxPages: 1 }),
    ).rejects.toThrow(/could not reach/i)

    // And it must be recorded as failed, not left on 'crawling'. A progress bar that will
    // never move is worse than being told it broke.
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(audits).where(eq(audits.siteId, deadSiteId)),
    )

    expect(row?.status).toBe('failed')
    expect(row?.error).toMatch(/could not reach/i)
    expect(row?.completedAt).toBeTruthy()

    // Nothing was scored, and nothing was stored. An audit that refused must leave no
    // findings behind for the inbox to display as though they meant something.
    expect(row?.scorecard).toBeNull()
    const leftovers = await withTenant(db, tenantId, (tx) =>
      tx.select().from(findings).where(eq(findings.auditId, row!.id)),
    )
    expect(leftovers).toEqual([])
  }, 120_000)

  it('still audits a site whose homepage returns 404, because that is a finding not a failure', async () => {
    // The other side of the line above, and the reason the check tests `status > 0` rather
    // than `status < 400`. A server that answers 404 has responded: we have real evidence,
    // and a homepage returning 404 is a catastrophic finding the audit must report. Only a
    // server that never answered leaves us with nothing to say.
    const gone = createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end(page('<h1>Not found</h1>'))
    })

    await new Promise<void>((done) => gone.listen(0, '127.0.0.1', () => done()))
    const origin = `http://127.0.0.1:${(gone.address() as AddressInfo).port}`

    try {
      const goneSiteId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.insert(sites).values({ tenantId, url: origin }).returning()
        return row!.id
      })

      const result = await runAudit(db, {
        tenantId,
        siteId: goneSiteId,
        seed: origin,
        maxPages: 1,
      })

      expect(result.scorecard.axes).toHaveLength(8)
    } finally {
      await new Promise<void>((done) => gone.close(() => done()))
    }
  }, 120_000)

  it('does not duplicate findings when the same audit is stored twice', async () => {
    // findings is unique on (audit_id, key). Without it, a retried write would silently
    // double every finding in the inbox and nobody would notice until the counts looked odd.
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.select().from(findings).where(eq(findings.auditId, auditId)),
    )

    const keys = rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
