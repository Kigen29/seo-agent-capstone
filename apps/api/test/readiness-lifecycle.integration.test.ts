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
  for (const [status, expected] of [
    [403, 'Deployments read permission'],
    [401, 'authentication failed'],
    [503, 'could not be read'],
  ] as const) {
    await expect(
      runVerifyFix(
        db,
        { tenantId, siteId },
        {
          isDeployed: async () => {
            throw Object.assign(new Error('sensitive upstream response'), { status })
          },
          audit: async () => {
            throw new Error('Must not crawl without deployment evidence')
          },
        },
      ),
    ).rejects.toThrow(expected)
    const denied = await read()
    expect(denied.status).toBe('merged')
    expect(denied.verification).toBeNull()
    expect(denied.fixError).toContain(expected)
    expect(denied.fixError).not.toContain('sensitive upstream response')
  }
  await expect(
    runVerifyFix(db, { tenantId, siteId }, { isDeployed: async () => false, audit: realAudit }),
  ).rejects.toThrow('inconclusive')
  expect((await read()).status).toBe('merged')
  expect((await read()).verification).toBeNull()

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
  await runVerifyFix(db, { tenantId, siteId }, { isDeployed: async () => true, audit: realAudit })
  expect((await read()).status).toBe('rejected')
  expect((await read()).verification?.after.metrics[0]?.value).toBeGreaterThan(0)

  robots = proposedRobots
  await withTenant(db, tenantId, (tx) =>
    tx.update(findings).set({ status: 'merged' }).where(eq(findings.id, finding!.id)),
  )
  await runVerifyFix(db, { tenantId, siteId }, { isDeployed: async () => true, audit: realAudit })
  const final = await read()
  expect(final.status).toBe('verified')
  expect(final.fixError).toBeNull()
  expect(final.baseline?.metrics[0]?.value).toBeGreaterThan(0)
  expect(final.verification?.after.metrics[0]?.value).toBe(0)
}, 120_000)
