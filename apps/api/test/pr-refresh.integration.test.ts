import { apiTokens, asOwner, audits, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import type { VerifyFixJob } from '@seo/queue'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'
import { resetPullRequestRefreshThrottle } from '../src/pr-refresh.js'

/**
 * A merge whose webhook was lost, noticed when somebody looks at the finding.
 *
 * The case this exists for is real: a fix was merged, the webhook reached an API that was asleep,
 * the scheduled worker did not run for hours, and the finding kept saying its pull request was
 * open. Nothing here involves a webhook or a worker on purpose. The only thing that happens is a
 * GET, and the finding has to be right afterwards.
 */
const { db, pool } = createDb(process.env.DATABASE_URL)
const PR_URL = 'https://github.com/octo/refresh/pull/12'

let app: FastifyInstance
let tenantId: string
let token: string
let siteId: string
let findingId: string
/** What the fake GitHub says became of the pull request. Null means it could not be read. */
let github: { merged: boolean; closed: boolean } | null | Error
const asked: number[] = []
const verifyQueued: VerifyFixJob[] = []

const get = (path: string) =>
  app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } })

const statusInDb = async () =>
  (
    await withTenant(db, tenantId, (tx) =>
      tx
        .select({ status: findings.status, prUrl: findings.prUrl })
        .from(findings)
        .where(eq(findings.id, findingId)),
    )
  )[0]

const setWaiting = () =>
  withTenant(db, tenantId, (tx) =>
    tx.update(findings).set({ status: 'pr_open', prUrl: PR_URL }).where(eq(findings.id, findingId)),
  )

beforeAll(async () => {
  app = await buildApp({
    db,
    enqueueVerifyFix: async (job) => {
      verifyQueued.push(job)
    },
    github: {
      slug: 'test-app',
      webhookSecret: 'unused-here',
      app: {
        apiFor: async () => ({
          getPullRequest: async (number: number) => {
            asked.push(number)
            if (github instanceof Error) throw github
            return github
          },
        }),
        listInstallationRepositories: async () => [],
      } as never,
    },
  })
  tenantId = await asOwner(
    db,
    async (tx) => (await tx.insert(tenants).values({ name: 'pr-refresh' }).returning())[0]!.id,
  )
  const plain = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({ tenantId, name: 'test', tokenHash: hashToken(plain) }),
  )
  token = plain

  await withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        tenantId,
        url: 'https://refresh.example.com/',
        repoFullName: 'octo/refresh',
        githubInstallationId: 21,
      })
      .returning()
    siteId = site!.id
    const [audit] = await tx
      .insert(audits)
      .values({ tenantId, siteId, status: 'complete' })
      .returning()
    const [finding] = await tx
      .insert(findings)
      .values({
        tenantId,
        siteId,
        auditId: audit!.id,
        ruleId: 'AGENT-001',
        key: 'AGENT-001#0',
        axis: 'agent_readiness',
        severity: 'low',
        confidence: 1,
        title: 'https://refresh.example.com has no llms.txt',
        evidence: {
          kind: 'markup',
          url: 'https://refresh.example.com/',
          locator: '/llms.txt',
          snippet: '',
          observedAt: '2026-10-05T00:00:00.000Z',
          source: 'crawler',
        },
        affectedUrls: ['https://refresh.example.com/'],
        estimatedEffort: 'trivial',
        estimatedImpact: 20,
        falsification: 'Request /llms.txt; if it returns the file, this was wrong.',
        fixable: true,
        status: 'pr_open',
        prUrl: PR_URL,
      })
      .returning()
    findingId = finding!.id
  })
})

beforeEach(async () => {
  resetPullRequestRefreshThrottle()
  asked.length = 0
  verifyQueued.length = 0
  await setWaiting()
})

afterAll(async () => {
  await app?.close()
  if (tenantId) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await pool.end()
})

describe('reading a finding that is waiting on a pull request', () => {
  it('notices a merge with no webhook and no worker, and answers with the new state', async () => {
    github = { merged: true, closed: true }

    const res = await get(`/findings/${findingId}`)

    expect(res.statusCode).toBe(200)
    // The response itself is already right: the person does not have to reload to see it.
    expect((res.json() as { finding: { status: string } }).finding.status).toBe('merged')
    expect(asked).toEqual([12])
    // And the rest of the loop starts, exactly as the webhook would have started it.
    expect(verifyQueued).toEqual([expect.objectContaining({ tenantId, siteId })])
  })

  it('reopens the finding when the pull request was closed without merging', async () => {
    github = { merged: false, closed: true }

    const res = await get(`/findings/${findingId}`)

    expect((res.json() as { finding: { status: string } }).finding.status).toBe('open')
    expect(await statusInDb()).toEqual({ status: 'open', prUrl: null })
    expect(verifyQueued).toEqual([])
  })

  it('leaves it alone while the pull request really is still open', async () => {
    github = { merged: false, closed: false }

    const res = await get(`/findings/${findingId}`)

    expect((res.json() as { finding: { status: string } }).finding.status).toBe('pr_open')
  })

  it('answers with what it has when GitHub cannot be read, and changes nothing', async () => {
    for (const failure of [null, new Error('GitHub is down')]) {
      resetPullRequestRefreshThrottle()
      github = failure

      const res = await get(`/findings/${findingId}`)

      expect(res.statusCode).toBe(200)
      expect((await statusInDb())?.status).toBe('pr_open')
    }
  })

  it('does not ask GitHub again on every poll of the same finding', async () => {
    github = { merged: false, closed: false }

    await get(`/findings/${findingId}`)
    await get(`/findings/${findingId}`)
    await get(`/findings/${findingId}`)

    expect(asked).toHaveLength(1)
  })

  it('notices it from the outcomes page as well', async () => {
    github = { merged: true, closed: true }

    const res = await get(`/sites/${siteId}/outcomes`)

    const body = res.json() as { counts: Record<string, number>; outcomes: { status: string }[] }
    expect(body.counts).toMatchObject({ pr_open: 0, merged: 1 })
    expect(body.outcomes[0]?.status).toBe('merged')
  })

  it('never asks about a finding that is not waiting on a pull request', async () => {
    github = { merged: true, closed: true }
    await withTenant(db, tenantId, (tx) =>
      tx.update(findings).set({ status: 'open', prUrl: null }).where(eq(findings.id, findingId)),
    )

    await get(`/findings/${findingId}`)

    expect(asked).toEqual([])
  })
})
