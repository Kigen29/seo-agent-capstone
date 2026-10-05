import { fingerprintOf } from '@seo/audit'
import { apiTokens, asOwner, audits, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import type { FixJob } from '@seo/queue'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * The same issue, raised by two audits (ADR-0029), across the HTTP boundary.
 *
 * The case that matters: a pull request is open for an issue, the site is audited again, and the
 * newer audit raises the issue afresh as an open, fixable finding. The inbox only shows the newest
 * audit, so that row is the one a person sees, and its Fix button must not open a second pull
 * request for work that is already in flight.
 */
const { db, pool } = createDb(process.env.DATABASE_URL)
const PR_URL = 'https://github.com/octo/identity/pull/3'
const PAGE = 'https://identity.example.com/about'

let app: FastifyInstance
let tenantId: string
let token: string
let earlierId: string
let againId: string
const queued: FixJob[] = []

const call = (method: 'GET' | 'POST', path: string) =>
  app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` } })

const setEarlier = (status: 'pr_open' | 'merged' | 'verified' | 'rejected') =>
  withTenant(db, tenantId, (tx) =>
    tx.update(findings).set({ status }).where(eq(findings.id, earlierId)),
  )

beforeAll(async () => {
  app = await buildApp({
    db,
    enqueueFix: async (job) => {
      queued.push(job)
    },
  })
  tenantId = await asOwner(
    db,
    async (tx) =>
      (await tx.insert(tenants).values({ name: 'finding-identity' }).returning())[0]!.id,
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
        url: 'https://identity.example.com/',
        repoFullName: 'octo/identity',
        githubInstallationId: 11,
      })
      .returning()
    const auditAt = (completedAt: Date) =>
      tx
        .insert(audits)
        .values({
          tenantId,
          siteId: site!.id,
          status: 'complete',
          startedAt: completedAt,
          completedAt,
        })
        .returning()
    const [first] = await auditAt(new Date('2026-09-01T00:00:00Z'))
    const [second] = await auditAt(new Date('2026-10-01T00:00:00Z'))

    const row = (auditId: string, createdAt: Date) => ({
      tenantId,
      siteId: site!.id,
      auditId,
      ruleId: 'TECH-004',
      key: 'TECH-004#0',
      fingerprint: fingerprintOf({ ruleId: 'TECH-004', title: '', affectedUrls: [PAGE] }),
      firstSeenAt: new Date('2026-09-01T00:00:00Z'),
      createdAt,
      axis: 'crawl_health' as const,
      severity: 'medium' as const,
      confidence: 1,
      title: `Sitemap lists ${PAGE}, which redirects`,
      evidence: {
        kind: 'http' as const,
        url: PAGE,
        status: 301,
        redirectChain: [PAGE],
        observedAt: '2026-09-01T00:00:00.000Z',
        source: 'crawler' as const,
      },
      affectedUrls: [PAGE],
      estimatedEffort: 'small' as const,
      estimatedImpact: 30,
      falsification: 'Re-fetch the URL; if it returns 200 and does not redirect, this was wrong.',
      fixable: true,
    })
    const [earlier] = await tx
      .insert(findings)
      .values({ ...row(first!.id, first!.startedAt), status: 'pr_open', prUrl: PR_URL })
      .returning()
    const [again] = await tx
      .insert(findings)
      .values({ ...row(second!.id, second!.startedAt), status: 'open' })
      .returning()
    earlierId = earlier!.id
    againId = again!.id
  })
})

afterAll(async () => {
  await app?.close()
  if (tenantId) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await pool.end()
})

describe('an issue raised again while its fix is in flight', () => {
  it('tells the newer finding about the pull request, and when the issue was first seen', async () => {
    const { finding } = (await call('GET', `/findings/${againId}`)).json() as {
      finding: { firstSeenAt: string; earlier: { work: string; rowId: string; prUrl: string } }
    }

    expect(finding.earlier).toEqual({ work: 'in_progress', rowId: earlierId, prUrl: PR_URL })
    expect(finding.firstSeenAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('shows it on the inbox row, which lists only the newer audit', async () => {
    const { findings: rows } = (await call('GET', '/findings')).json() as {
      findings: { rowId: string; earlier: { work: string } | null }[]
    }

    expect(rows.map((row) => row.rowId)).toEqual([againId])
    expect(rows[0]?.earlier?.work).toBe('in_progress')
  })

  it('refuses a second fix, names the pull request, and queues nothing', async () => {
    const res = await call('POST', `/findings/${againId}/fix`)

    expect(res.statusCode).toBe(409)
    expect((res.json() as { message: string }).message).toContain(PR_URL)
    expect(queued).toHaveLength(0)
  })

  it('still refuses once that pull request is merged and waiting to be checked', async () => {
    await setEarlier('merged')

    expect((await call('POST', `/findings/${againId}/fix`)).statusCode).toBe(409)
    expect(queued).toHaveLength(0)
  })

  it('offers the fix again once the earlier one was checked and did not work', async () => {
    await setEarlier('rejected')

    const { finding } = (await call('GET', `/findings/${againId}`)).json() as {
      finding: { earlier: { work: string } }
    }
    expect(finding.earlier.work).toBe('fix_failed')

    expect((await call('POST', `/findings/${againId}/fix`)).statusCode).toBe(202)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ tenantId, findingRowId: againId })
  })
})
