import { decryptToken } from '@seo/connectors'
import {
  apiTokens,
  asOwner,
  createDb,
  hostingConnections,
  sites,
  tenants,
  withTenant,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'
import { signInstallState } from '../src/github-state.js'

/**
 * Connecting Vercel with one button (ADR-0033).
 *
 * Vercel itself is replaced: the code exchange, the project listing and the proof that a project
 * serves the site are all injected. What is under test is ours. That the consent is bound to one
 * tenant and one site by a state nobody else can mint, that the project is chosen by proof and
 * not by position, that the token granted is stored where only that site can use it and is never
 * returned, and that every way it can fail sends the person back with a reason and stores
 * nothing.
 */
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const { db, pool } = createDb(process.env.DATABASE_URL)
const WEB = 'https://app.example.com'
const GRANTED = 'vercel-granted-token-that-must-never-come-back'

let app: FastifyInstance
let bare: FastifyInstance
let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string
let siteId: string
let noRepoSiteId: string

// What the fake Vercel says, set per test.
let projects: { id: string; name: string }[] = []
let serving: string[] = []
let exchanged: string[] = []
let listed: { token: string; teamId?: string; repoFullName: string }[] = []
let grantTeam: string | undefined

const mint = (tenant: string) => {
  const plain = generateToken()
  return asOwner(db, async (tx) => {
    await tx
      .insert(apiTokens)
      .values({ tenantId: tenant, name: 'test', tokenHash: hashToken(plain) })
    return plain
  })
}

const stored = () =>
  withTenant(db, tenantId, (tx) =>
    tx.select().from(hostingConnections).where(eq(hostingConnections.siteId, siteId)),
  )

const callback = (query: Record<string, string>, on: FastifyInstance = app) =>
  on.inject({ method: 'GET', url: `/connections/vercel/callback?${new URLSearchParams(query)}` })

const landed = (response: { headers: Record<string, unknown> }) =>
  new URL(String(response.headers.location))

beforeAll(async () => {
  const shared = {
    db,
    webUrl: WEB,
    validateHosting: async (input: { projectId: string }) => serving.includes(input.projectId),
    findVercelProjects: async (options: {
      token: string
      teamId?: string
      repoFullName: string
    }) => {
      listed.push(options)
      return projects
    },
    exchangeVercelCode: async (_integration: unknown, code: string) => {
      exchanged.push(code)
      if (code === 'refused') throw new Error('Vercel refused the code exchange (400).')
      return { token: GRANTED, ...(grantTeam ? { teamId: grantTeam } : {}) }
    },
  }
  app = await buildApp({
    ...shared,
    vercel: {
      clientId: 'oac_client',
      clientSecret: 'client-secret',
      slug: 'rankwright',
      redirectUri: 'https://api.example.com/connections/vercel/callback',
    },
  })
  // The same API with no integration registered, which is how most deployments start.
  bare = await buildApp(shared)
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: 'vercel-connect' }, { name: 'vercel-connect-other' }])
      .returning()
    return [rows[0]!.id, rows[1]!.id]
  })
  token = await mint(tenantId)
  otherToken = await mint(otherTenantId)

  await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .insert(sites)
      .values([
        {
          tenantId,
          url: 'https://vercel-connect.example.com/',
          repoFullName: 'octo/site',
          githubInstallationId: 41,
        },
        { tenantId, url: 'https://vercel-norepo.example.com/' },
      ])
      .returning()
    siteId = rows[0]!.id
    noRepoSiteId = rows[1]!.id
  })
})

beforeEach(async () => {
  projects = [{ id: 'prj_site', name: 'site' }]
  serving = ['prj_site']
  exchanged = []
  listed = []
  grantTeam = undefined
  await withTenant(db, tenantId, (tx) =>
    tx.delete(hostingConnections).where(eq(hostingConnections.siteId, siteId)),
  )
})

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    if (id) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, id)))
  }
  await app.close()
  await bare.close()
  await pool.end()
})

const start = (id: string, bearer = token, on: FastifyInstance = app) =>
  on.inject({
    method: 'POST',
    url: `/sites/${id}/hosting/vercel`,
    headers: { authorization: `Bearer ${bearer}` },
  })

describe('POST /sites/:siteId/hosting/vercel', () => {
  it('returns the consent address, carrying a state the callback will accept', async () => {
    const response = await start(siteId)

    expect(response.statusCode).toBe(200)
    const url = new URL(response.json().url)
    expect(url.origin + url.pathname).toBe('https://vercel.com/integrations/rankwright/new')

    const back = await callback({ code: 'good', state: url.searchParams.get('state')! })
    expect(landed(back).searchParams.get('vercel')).toBe('connected')
  })

  it("answers 404 for another tenant's site, so no state is ever minted for it", async () => {
    expect((await start(siteId, otherToken)).statusCode).toBe(404)
  })

  it('asks for the repository first', async () => {
    expect((await start(noRepoSiteId)).statusCode).toBe(409)
  })

  it('says the button is not set up when no integration is registered', async () => {
    expect((await start(siteId, token, bare)).statusCode).toBe(503)
    const status = await bare.inject({
      method: 'GET',
      url: `/sites/${siteId}/hosting`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(status.json().oneClick).toBe(false)
  })
})

describe('GET /connections/vercel/callback', () => {
  const state = () => signInstallState({ tenantId, siteId })

  it('stores the granted token for this site, and sends the person back to its hosting page', async () => {
    const response = await callback({ code: 'good', state: state(), configurationId: 'icfg_1' })

    expect(response.statusCode).toBe(302)
    const to = landed(response)
    expect(to.origin + to.pathname).toBe(`${WEB}/settings/connections/hosting`)
    expect(to.searchParams.get('siteId')).toBe(siteId)
    expect(to.searchParams.get('vercel')).toBe('connected')
    // The granted token is nowhere in the address the browser is sent to.
    expect(String(response.headers.location)).not.toContain(GRANTED)

    const [row] = await stored()
    expect(row).toMatchObject({ projectId: 'prj_site', teamId: null, repoFullName: 'octo/site' })
    expect(JSON.parse(decryptToken(row!.tokenEncrypted))).toEqual({
      tenantId,
      siteId,
      token: GRANTED,
    })
  })

  it('never hands the token back through the status route', async () => {
    await callback({ code: 'good', state: state() })
    const status = await app.inject({
      method: 'GET',
      url: `/sites/${siteId}/hosting`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(status.json()).toMatchObject({ oneClick: true, mode: 'vercel' })
    expect(status.body).not.toContain(GRANTED)
  })

  it('keeps the project that is proved to serve the site, not the first one listed', async () => {
    projects = [
      { id: 'prj_staging', name: 'staging' },
      { id: 'prj_production', name: 'production' },
    ]
    serving = ['prj_production']

    await callback({ code: 'good', state: state() })

    expect((await stored())[0]).toMatchObject({ projectId: 'prj_production' })
  })

  it('looks in the team the grant names, and stores it', async () => {
    grantTeam = 'team_granted'

    await callback({ code: 'good', state: state(), teamId: 'team_from_query' })

    expect(listed[0]).toMatchObject({ teamId: 'team_granted', repoFullName: 'octo/site' })
    expect((await stored())[0]).toMatchObject({ teamId: 'team_granted' })
  })

  it('says so, and stores nothing, when the account has no project for the repository', async () => {
    projects = []

    const response = await callback({ code: 'good', state: state() })

    expect(landed(response).searchParams.get('vercel')).toBe('no_project')
    expect(await stored()).toEqual([])
  })

  it('stores nothing when no project is proved to serve the site', async () => {
    serving = []

    const response = await callback({ code: 'good', state: state() })

    expect(landed(response).searchParams.get('vercel')).toBe('unconfirmed')
    expect(await stored()).toEqual([])
  })

  it('refuses a state it did not sign, before spending the code', async () => {
    const forged = `${state().split('.')[0]}.not-our-signature`

    const response = await callback({ code: 'good', state: forged })

    expect(landed(response).searchParams.get('vercel')).toBe('invalid')
    expect(exchanged).toEqual([])
    expect(await stored()).toEqual([])
  })

  it("refuses a state minted for a site that is not that tenant's", async () => {
    const crossed = signInstallState({ tenantId: otherTenantId, siteId })

    const response = await callback({ code: 'good', state: crossed })

    expect(landed(response).searchParams.get('vercel')).toBe('invalid')
    expect(await stored()).toEqual([])
  })

  it('treats a return with no code as a declined approval', async () => {
    const response = await callback({ state: state() })

    expect(landed(response).searchParams.get('vercel')).toBe('declined')
    expect(exchanged).toEqual([])
  })

  it('says it failed, and stores nothing, when Vercel refuses the code', async () => {
    const response = await callback({ code: 'refused', state: state() })

    expect(landed(response).searchParams.get('vercel')).toBe('failed')
    expect(await stored()).toEqual([])
  })
})

describe('PUT /sites/:siteId/hosting with only a token', () => {
  it('finds the project from the repository, so no project id has to be looked up', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/sites/${siteId}/hosting`,
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'pasted-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ connected: true, projectId: 'prj_site' })
    expect(listed[0]).toMatchObject({ token: 'pasted-token', repoFullName: 'octo/site' })
  })

  it('explains what to check when the token can see no project for the repository', async () => {
    projects = []

    const response = await app.inject({
      method: 'PUT',
      url: `/sites/${siteId}/hosting`,
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'pasted-token' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().message).toContain('no Vercel project that deploys octo/site')
  })
})
