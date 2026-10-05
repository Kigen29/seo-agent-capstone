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
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { priorityScore } from '@seo/core'
import { fingerprintOf } from '../src/fingerprint.js'
import { getAudit, getFinding, listFindings, listSites } from '../src/queries.js'
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

/** Fixture servers listen on 127.0.0.1, which production egress rightly refuses. */
const LOCAL = { allowPrivateNetwork: true }

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

    const result = await runAudit(db, {
      egress: LOCAL,
      tenantId,
      siteId,
      seed: site.origin,
      maxPages: 5,
    })
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

  it('stores a priority score matching the formula, for every finding it writes', async () => {
    /**
     * The guard on a denormalised column, placed on the path that actually writes it.
     *
     * `priority_score` exists so the inbox can order and paginate in SQL, and it is filled in by
     * `runAudit` at insert time. If it ever diverges from `priorityScore()`, the backlog is sorted
     * wrongly, permanently, and nothing else in the system would notice: the number still looks
     * like a number and the page still renders.
     */
    const rows = await withTenant(db, tenantId, (tx) =>
      tx
        .select({
          stored: findings.priorityScore,
          severity: findings.severity,
          confidence: findings.confidence,
          estimatedImpact: findings.estimatedImpact,
          estimatedEffort: findings.estimatedEffort,
        })
        .from(findings)
        .where(eq(findings.auditId, auditId)),
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.stored).toBeCloseTo(priorityScore(row), 4)
    }
  })

  it('stores the eight-axis scorecard whole, blanks included', async () => {
    const audit = await getAudit(db, tenantId, auditId)

    expect(audit?.scorecard?.axes).toHaveLength(8)

    // The unmeasured axes must survive the round trip as nulls. If jsonb or the schema ever
    // coerced them to 0 or 100, the dashboard would start lying about what we checked, and it
    // would do it silently. Two, not four: agent readiness (llms.txt) and local (LocalBusiness)
    // are now measured, so only performance and authority remain unconnected.
    const unmeasured = audit?.scorecard?.axes.filter((a) => a.status === 'not_measured') ?? []
    expect(unmeasured).toHaveLength(2)
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

    // Any rule family, not just TECH. This asserted `/^TECH-\d{3}#\d+$/` and passed only because
    // the crawl fixture happened to raise TECH findings first; adding the agent-readiness rules
    // put AGENT-002 at the top and it went red. The property that matters is the *shape* of the
    // key, which is a rule id and an index, not which family of rule got there first.
    expect(finding.id).toMatch(/^[A-Z]+-\d{3}#\d+$/)
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
      runAudit(db, {
        egress: LOCAL,
        tenantId,
        siteId: deadSiteId,
        seed: 'http://127.0.0.1:1/',
        maxPages: 1,
      }),
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

  it('refuses a private seed under the default egress policy, and says why', async () => {
    // Production passes no egress option. A site URL pointing at a private address must fail
    // with the refusal as its reason, never be fetched, and never be scored.
    const privateSiteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ tenantId, url: `${site.origin}/private` })
        .returning()
      return row!.id
    })

    await expect(
      runAudit(db, {
        tenantId,
        siteId: privateSiteId,
        seed: `${site.origin}/private`,
        maxPages: 1,
      }),
    ).rejects.toThrow(/Refused by egress policy/)

    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(audits).where(eq(audits.siteId, privateSiteId)),
    )
    expect(row?.status).toBe('failed')
    expect(row?.scorecard).toBeNull()
  })

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
        egress: LOCAL,
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

  describe('the same issue on the next audit (ADR-0029)', () => {
    let secondAuditId: string
    let wontfixFingerprint: string
    let prFingerprint: string
    const PR_URL = 'https://github.com/octo/site/pull/7'

    const rowsOf = (id: string) =>
      withTenant(db, tenantId, (tx) => tx.select().from(findings).where(eq(findings.auditId, id)))

    beforeAll(async () => {
      const first = await rowsOf(auditId)
      // A person decides one issue is not worth fixing, and a pull request is opened for another.
      const [wontfix, withPr] = [first[0]!, first[1]!]
      wontfixFingerprint = wontfix.fingerprint!
      prFingerprint = withPr.fingerprint!
      await withTenant(db, tenantId, async (tx) => {
        await tx.update(findings).set({ status: 'wontfix' }).where(eq(findings.id, wontfix.id))
        await tx
          .update(findings)
          .set({ status: 'pr_open', prUrl: PR_URL })
          .where(eq(findings.id, withPr.id))
      })

      secondAuditId = (
        await runAudit(db, { egress: LOCAL, tenantId, siteId, seed: site.origin, maxPages: 5 })
      ).auditId
    }, 180_000)

    it('gives every finding a fingerprint, unique within the audit', async () => {
      const rows = await rowsOf(secondAuditId)

      expect(rows.length).toBeGreaterThan(1)
      expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.fingerprint ?? ''))).toBe(true)
      expect(new Set(rows.map((row) => row.fingerprint)).size).toBe(rows.length)
    })

    it('recognises an unchanged site as the same issues, first seen when they first were', async () => {
      const first = await rowsOf(auditId)
      const second = await rowsOf(secondAuditId)

      expect(second.map((row) => row.fingerprint).sort()).toEqual(
        first.map((row) => row.fingerprint).sort(),
      )
      const firstSeen = new Map(first.map((row) => [row.fingerprint, row.firstSeenAt.getTime()]))
      for (const row of second) {
        expect(row.firstSeenAt.getTime()).toBe(firstSeen.get(row.fingerprint))
        // Carried, not re-stamped: the new row was created later than the issue was first seen.
        expect(row.createdAt.getTime()).toBeGreaterThan(row.firstSeenAt.getTime())
      }
    })

    it("carries a won't-fix decision onto the new audit instead of forgetting it", async () => {
      const second = await rowsOf(secondAuditId)

      expect(second.find((row) => row.fingerprint === wontfixFingerprint)?.status).toBe('wontfix')
    })

    it('does not copy a pull request onto the new row, and links to it instead', async () => {
      const second = await rowsOf(secondAuditId)
      const again = second.find((row) => row.fingerprint === prFingerprint)!

      // One pull request, one owner: the webhook and the verifier find it by URL on the old row.
      expect(again.status).toBe('open')
      expect(again.prUrl).toBeNull()

      const detail = await getFinding(db, tenantId, again.id)
      expect(detail?.earlier).toMatchObject({ work: 'in_progress', prUrl: PR_URL })

      const inbox = await listFindings(db, tenantId, { siteId, pageSize: 100 })
      expect(inbox.findings.find((row) => row.rowId === again.id)?.earlier).toMatchObject({
        work: 'in_progress',
        prUrl: PR_URL,
      })
      // An issue with nothing done about it before has nothing to point at.
      expect(inbox.findings.filter((row) => row.earlier !== null)).toHaveLength(1)
    })

    it('says an issue came back when its earlier fix had been verified', async () => {
      const first = await rowsOf(auditId)
      const earlier = first.find((row) => row.fingerprint === prFingerprint)!
      const second = await rowsOf(secondAuditId)
      const again = second.find((row) => row.fingerprint === prFingerprint)!
      const setEarlier = (status: 'verified' | 'rejected' | 'pr_open') =>
        withTenant(db, tenantId, (tx) =>
          tx.update(findings).set({ status }).where(eq(findings.id, earlier.id)),
        )

      try {
        await setEarlier('verified')
        expect((await getFinding(db, tenantId, again.id))?.earlier?.work).toBe('regressed')
        await setEarlier('rejected')
        expect((await getFinding(db, tenantId, again.id))?.earlier?.work).toBe('fix_failed')
      } finally {
        await setEarlier('pr_open')
      }
    })

    it('computes the same fingerprint the migration backfill does', async () => {
      // Migration 0030 fills old rows in SQL. If the two ever disagree, every finding written
      // before it stops being recognised, silently.
      const rows = await rowsOf(secondAuditId)
      const row = rows.find((r) => r.affectedUrls.length > 0 && r.ruleId !== 'TECH-011')!
      const result = await withTenant(db, tenantId, (tx) =>
        tx.execute(
          sql`select encode(sha256(convert_to(${row.ruleId} || '|' || ${row.affectedUrls[0]!}, 'UTF8')), 'hex') as fp`,
        ),
      )
      expect(result.rows[0]?.fp).toBe(fingerprintOf(row))
    })
  })
})
