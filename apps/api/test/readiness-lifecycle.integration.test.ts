import { createServer } from 'node:http'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { asOwner, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import { applyFixPrOutcome, runAudit } from '@seo/audit'
import type { VersionControlProvider } from '@seo/vcs'
import { eq } from 'drizzle-orm'
import { runFix } from '../../worker/src/fix.js'
import { enqueuePendingFixVerifications, runVerifyFix } from '../../worker/src/verify-fix.js'
import type { Queue } from '@seo/queue'

const { db, pool } = createDb(process.env.DATABASE_URL)
let tenantId: string
let siteId: string
let origin: string
let robots = 'User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: *\nAllow: /'
let proposedRobots = ''
const server = createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.setHeader('content-type', 'text/plain')
    res.end(robots)
    return
  }
  if (req.url !== '/') {
    res.writeHead(404).end()
    return
  }
  res.setHeader('content-type', 'text/html')
  res.end(
    '<html><head><title>Lifecycle fixture</title></head><body><h1>A business</h1></body></html>',
  )
})

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable')
  origin = `http://127.0.0.1:${address.port}/`
  tenantId = await asOwner(
    db,
    async (tx) =>
      (await tx.insert(tenants).values({ name: 'readiness-lifecycle' }).returning())[0]!.id,
  )
  siteId = await withTenant(
    db,
    tenantId,
    async (tx) =>
      (
        await tx
          .insert(sites)
          .values({ tenantId, url: origin, repoFullName: 'fixture/site', githubInstallationId: 42 })
          .returning()
      )[0]!.id,
  )
})
afterAll(async () => {
  if (tenantId) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await pool.end()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

it('audits, proposes a real generated patch, waits for deployment, recovers, then records success or failure', async () => {
  const audit = await runAudit(db, {
    tenantId,
    siteId,
    seed: origin,
    maxPages: 1,
    egress: { allowPrivateNetwork: true },
  })
  const [finding] = await withTenant(db, tenantId, async (tx) =>
    (await tx.select().from(findings).where(eq(findings.auditId, audit.auditId))).filter(
      (row) => row.ruleId === 'TECH-002',
    ),
  )
  expect(finding).toBeDefined()
  const prUrl = 'https://github.com/fixture/site/pull/1'
  const provider: VersionControlProvider = {
    findOpenPullRequest: async () => null,
    getFile: async (_ctx, path) =>
      path === 'robots.txt' ? { content: robots, sha: 'fixture' } : null,
    openPullRequest: async (_ctx, input) => {
      proposedRobots = input.files.find((file) => file.path === 'robots.txt')!.content
      expect(proposedRobots).toContain('Allow: /')
      expect(proposedRobots).not.toContain('Disallow: /')
      return { number: 1, url: prUrl, branch: 'seo-agent/fixture' }
    },
  }
  await runFix(
    db,
    { tenantId, siteId, findingRowId: finding!.id, requestId: 'lifecycle' },
    { provider },
  )
  expect(
    await applyFixPrOutcome(
      db,
      prUrl,
      { merged: true, closed: true },
      { repoFullName: 'fixture/site', installationId: 42 },
    ),
  ).toBe('merged')
  const read = async () =>
    (
      await withTenant(db, tenantId, (tx) =>
        tx.select().from(findings).where(eq(findings.id, finding!.id)),
      )
    )[0]!
  const realAudit: typeof runAudit = (database, options) =>
    runAudit(database, { ...options, maxPages: 1, egress: { allowPrivateNetwork: true } })
  const brokenRobots = robots
  const hour = 3_600_000
  const mergedAt = Date.now()
  const at = (hours: number) => new Date(mergedAt + hours * hour)
  const neverCrawl: typeof runAudit = async () => {
    throw new Error('Must not crawl: no checkpoint has passed since the last look')
  }

  /*
    No deployment report can be read, three different ways. The live site is looked at anyway
    (ADR-0047). It still shows the problem, and the merge is an hour or so old, so nothing is
    concluded: the fix stays merged, with a dated note saying what was seen and why there was
    no report, in our words and never the provider's.
  */
  for (const [status, expected, hours] of [
    [403, 'Deployments read permission', 2],
    [401, 'authentication failed', 4],
    [503, 'could not be read', 7],
  ] as const) {
    await runVerifyFix(
      db,
      { tenantId, siteId },
      {
        now: at(hours),
        isDeployed: async () => {
          throw Object.assign(new Error('sensitive upstream response'), { status })
        },
        audit: realAudit,
      },
    )
    const waiting = await read()
    expect(waiting.status).toBe('merged')
    expect(waiting.verification).toBeNull()
    expect(waiting.fixError).toMatch(/^Checked the live site on .* UTC: the problem is still there/)
    expect(waiting.fixError).toContain(expected)
    expect(waiting.fixError).not.toContain('sensitive upstream response')
  }

  // The host simply reports nothing. Same answer, and no reason to give for the missing report.
  await runVerifyFix(
    db,
    { tenantId, siteId },
    { now: at(13), isDeployed: async () => false, audit: realAudit },
  )
  expect((await read()).status).toBe('merged')
  expect((await read()).fixError).toMatch(/^Checked the live site/)
  expect((await read()).fixError).not.toContain('No deployment report')

  // Between checkpoints the site is not crawled again, and waiting is not a failed job.
  await runVerifyFix(
    db,
    { tenantId, siteId },
    { now: at(14), isDeployed: async () => false, audit: neverCrawl },
  )
  expect((await read()).status).toBe('merged')

  // An exhausted queue is recovered from database state, independently of a new webhook.
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(findings)
      .set({ verificationCheckedAt: new Date(0) })
      .where(eq(findings.id, finding!.id)),
  )
  const sent: unknown[] = []
  const queue = {
    send: async (_name: string, payload: unknown) => {
      sent.push(payload)
      return 'queued'
    },
  } as unknown as Queue
  await enqueuePendingFixVerifications(db, queue)
  expect(sent).toContainEqual({ tenantId, siteId })

  // Deployment happened, but it did not contain the intended change.
  await runVerifyFix(
    db,
    { tenantId, siteId },
    { now: at(15), isDeployed: async () => true, audit: realAudit },
  )
  expect((await read()).status).toBe('rejected')
  expect((await read()).verification?.after.metrics[0]?.value).toBeGreaterThan(0)
  // With a report, the basis is the report, and the record does not say otherwise.
  expect((await read()).verification?.summary).not.toContain('no deployment report')

  const reopen = () =>
    withTenant(db, tenantId, (tx) =>
      tx
        .update(findings)
        .set({ status: 'merged', verification: null, fixError: null })
        .where(eq(findings.id, finding!.id)),
    )

  /*
    The loop closing with no report at all, which is every host that sends none. The fix is
    live, the worker looks, and the page is the evidence.
  */
  robots = proposedRobots
  await reopen()
  await runVerifyFix(
    db,
    { tenantId, siteId },
    { now: at(16), isDeployed: async () => false, audit: realAudit },
  )
  const final = await read()
  expect(final.status).toBe('verified')
  expect(final.fixError).toBeNull()
  expect(final.baseline?.metrics[0]?.value).toBeGreaterThan(0)
  expect(final.verification?.after.metrics[0]?.value).toBe(0)
  expect(final.verification?.summary).toContain('Confirmed on the live site itself')

  /*
    And the other ending. The problem is still on the live site two days after the merge, and
    nobody reported a deployment. That is recorded as not working, saying on what basis.
  */
  robots = brokenRobots
  await reopen()
  await runVerifyFix(
    db,
    { tenantId, siteId },
    { now: at(47), isDeployed: async () => false, audit: realAudit },
  )
  expect((await read()).status).toBe('merged')
  await runVerifyFix(
    db,
    { tenantId, siteId },
    { now: at(49), isDeployed: async () => false, audit: realAudit },
  )
  const failed = await read()
  expect(failed.status).toBe('rejected')
  expect(failed.verification?.summary).toContain('still there more than 48 hours after the merge')
  expect(failed.verification?.summary).toContain('no deployment report')
}, 120_000)
