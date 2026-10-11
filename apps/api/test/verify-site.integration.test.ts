import { randomBytes } from 'node:crypto'
import { VerificationInjectionError } from '@seo/agent'
import { googleAccessToken, GoogleNotConnectedError } from '@seo/audit'
import { encryptToken, GoogleReauthRequiredError } from '@seo/connectors'
import { apiTokens, asOwner, createDb, oauthCredentials, sites, tenants, withTenant } from '@seo/db'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'
import type { VersionControlProvider } from '@seo/vcs'
import { runVerify, verificationFailure } from '../../worker/src/verify.js'

/**
 * Search Console verification, where it used to fail without a word (ADR-0048).
 *
 * Found on a real account: the button was pressed three times over four days, each request
 * reached the worker, each failed there because Google refused the saved sign-in, and the site
 * went on saying nothing had been started while the connection went on saying "connected".
 *
 * So what is tested is what a person is told: that the failure is on the site, that the
 * connection says it needs connecting again, that the next press is refused at once and not ten
 * minutes later, and that a site Google already knows is theirs asks them for nothing.
 */

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const { db, pool } = createDb(process.env.DATABASE_URL)
const config = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.example/cb' }

let app: FastifyInstance
let tenantId: string
let token: string
const queued: unknown[] = []

const call = (method: 'GET' | 'POST', url: string) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` } })

async function newSite(host: string, withRepo = true): Promise<string> {
  return asOwner(db, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        tenantId,
        url: `https://${host}`,
        ...(withRepo ? { repoFullName: 'acme/site', githubInstallationId: 42 } : {}),
      })
      .returning()
    return site!.id
  })
}

const siteRow = async (id: string) =>
  (await withTenant(db, tenantId, (tx) => tx.select().from(sites).where(eq(sites.id, id))))[0]!

const credential = async () =>
  (
    await withTenant(db, tenantId, (tx) =>
      tx.select().from(oauthCredentials).where(eq(oauthCredentials.provider, 'google')),
    )
  )[0]

const setReconnect = (needsReconnectAt: Date | null) =>
  withTenant(db, tenantId, (tx) =>
    tx
      .update(oauthCredentials)
      .set({ needsReconnectAt })
      .where(and(eq(oauthCredentials.tenantId, tenantId), eq(oauthCredentials.provider, 'google'))),
  )

/** A token endpoint that answers as Google does. */
const tokenEndpoint = (status: number, body: object) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch

const refused = tokenEndpoint(400, { error: 'invalid_grant', error_description: 'Token expired.' })
const granted = tokenEndpoint(200, { access_token: 'ya29.fresh', expires_in: 3600 })

beforeAll(async () => {
  app = await buildApp({
    db,
    enqueueVerify: async (job) => {
      queued.push(job)
    },
  })
  tenantId = await asOwner(db, async (tx) => {
    const [row] = await tx
      .insert(tenants)
      .values({ name: `verify-${Date.now()}` })
      .returning()
    return row!.id
  })
  token = generateToken()
  await asOwner(db, async (tx) => {
    await tx.insert(apiTokens).values({ tenantId, name: 'test', tokenHash: hashToken(token) })
    await tx.insert(oauthCredentials).values({
      tenantId,
      provider: 'google',
      accountEmail: 'owner@example.com',
      refreshTokenEncrypted: encryptToken('refresh-token'),
      scopes: ['webmasters', 'siteverification'],
    })
  })
})

afterAll(async () => {
  await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await app.close()
  await pool.end()
})

describe('a Google sign-in that Google has stopped accepting', () => {
  it('is recorded the first time it is refused, and the connection then says so', async () => {
    expect((await call('GET', '/connections')).json().google).toEqual({
      connected: true,
      email: 'owner@example.com',
      needsReconnect: false,
    })

    await expect(googleAccessToken(db, tenantId, config, refused)).rejects.toBeInstanceOf(
      GoogleReauthRequiredError,
    )
    expect((await credential())!.needsReconnectAt).toBeInstanceOf(Date)

    // Still the same account, and still there to name: it is the grant that is dead.
    expect((await call('GET', '/connections')).json().google).toEqual({
      connected: true,
      email: 'owner@example.com',
      needsReconnect: true,
    })
  })

  it('keeps the time of the first refusal, however often it is refused again', async () => {
    const first = (await credential())!.needsReconnectAt!.getTime()
    await expect(googleAccessToken(db, tenantId, config, refused)).rejects.toThrow()
    expect((await credential())!.needsReconnectAt!.getTime()).toBe(first)
  })

  it('refuses a verification request at once, in words, and queues nothing', async () => {
    const siteId = await newSite('refused-at-once.example.com')
    const before = queued.length
    const response = await call('POST', `/sites/${siteId}/verify`)
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toMatch(/Google rejected the saved sign-in/)
    expect(response.json().message).toMatch(/Connect Google again/)
    expect(queued).toHaveLength(before)
  })

  it('is not flagged by an outage, which says nothing about the grant', async () => {
    await setReconnect(null)
    const outage = tokenEndpoint(503, { error: 'backend_error' })
    await expect(googleAccessToken(db, tenantId, config, outage)).rejects.toThrow(/503/)
    expect((await credential())!.needsReconnectAt).toBeNull()
  })

  it('clears itself as soon as Google grants a token again', async () => {
    await setReconnect(new Date())
    expect(await googleAccessToken(db, tenantId, config, granted)).toBe('ya29.fresh')
    expect((await credential())!.needsReconnectAt).toBeNull()
    expect((await call('GET', '/connections')).json().google.needsReconnect).toBe(false)
  })

  it('is told apart from no connection at all', async () => {
    const other = await asOwner(db, async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ name: `verify-none-${Date.now()}` })
        .returning()
      return row!.id
    })
    await expect(googleAccessToken(db, other, config, granted)).rejects.toBeInstanceOf(
      GoogleNotConnectedError,
    )
    await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, other)))
  })
})

/** Stands in for GitHub. The orchestration that would call it is replaced in each test. */
const provider = {} as VersionControlProvider

describe('verifying a site', () => {
  const never = async (): Promise<never> => {
    throw new Error('Must not open a pull request')
  }

  it('asks for nothing when the Google account already has the site verified', async () => {
    const siteId = await newSite('already-mine.example.com')
    await runVerify(
      db,
      { tenantId, siteId, requestId: 'r1' },
      {
        accessToken: async () => 'ya29.test',
        gsc: () => ({
          listProperties: async () => [
            { siteUrl: 'https://unrelated.example.org/', permissionLevel: 'siteOwner' },
            // Verified with www, added without: one site.
            { siteUrl: 'https://www.already-mine.example.com/', permissionLevel: 'siteOwner' },
          ],
          addSite: never,
        }),
        open: never,
        provider,
      },
    )
    const row = await siteRow(siteId)
    expect(row.gscVerificationStatus).toBe('verified')
    expect(row.gscProperty).toBe('https://www.already-mine.example.com/')
    expect(row.gscVerificationPrUrl).toBeNull()
    expect(row.gscVerificationError).toBeNull()
  })

  it('does not take a property the account has added and never verified', async () => {
    const siteId = await newSite('added-not-proven.example.com')
    let opened = 0
    await runVerify(
      db,
      { tenantId, siteId, requestId: 'r2' },
      {
        accessToken: async () => 'ya29.test',
        gsc: () => ({
          listProperties: async () => [
            {
              siteUrl: 'https://added-not-proven.example.com/',
              permissionLevel: 'siteUnverifiedUser',
            },
          ],
          addSite: async () => {},
        }),
        open: async () => {
          opened += 1
          return {
            property: 'https://added-not-proven.example.com/',
            framework: 'nextjs',
            token: '<meta name="google-site-verification" content="x" />',
            pr: { url: 'https://github.com/acme/site/pull/9', branch: 'seo-agent/verify' },
          }
        },
        provider,
      },
    )
    expect(opened).toBe(1)
    const row = await siteRow(siteId)
    expect(row.gscVerificationStatus).toBe('pr_open')
    expect(row.gscVerificationPrUrl).toBe('https://github.com/acme/site/pull/9')
  })

  it('writes the reason on the site when Google refuses, and flags nothing it should not', async () => {
    const siteId = await newSite('google-said-no.example.com')
    await expect(
      runVerify(
        db,
        { tenantId, siteId, requestId: 'r3' },
        {
          accessToken: async () => {
            throw new GoogleReauthRequiredError()
          },
          open: never,
        },
      ),
    ).rejects.toBeInstanceOf(GoogleReauthRequiredError)

    const row = await siteRow(siteId)
    // Still not started, so the button is still offered, and now it says why it did not work.
    expect(row.gscVerificationStatus).toBe('none')
    expect(row.gscVerificationError).toMatch(/Google rejected the saved sign-in/)

    const listed = (await call('GET', '/sites')).json().sites as {
      id: string
      gscVerificationError: string | null
    }[]
    expect(listed.find((site) => site.id === siteId)?.gscVerificationError).toMatch(
      /Connect Google again/,
    )
  })

  it('never shows a provider’s own words, whatever went wrong', async () => {
    const siteId = await newSite('upstream-leak.example.com')
    await expect(
      runVerify(
        db,
        { tenantId, siteId, requestId: 'r4' },
        {
          accessToken: async () => 'ya29.test',
          gsc: () => ({ listProperties: async () => [], addSite: async () => {} }),
          open: async () => {
            throw new Error('403 from api.github.com: token ghs_SECRETVALUE lacks contents:write')
          },
          provider,
        },
      ),
    ).rejects.toThrow()
    const shown = (await siteRow(siteId)).gscVerificationError ?? ''
    expect(shown).not.toContain('ghs_SECRETVALUE')
    expect(shown).not.toContain('api.github.com')
    expect(shown).toMatch(/could not be opened/)
  })

  it('says what to do when the repository has nowhere to put the tag', async () => {
    const siteId = await newSite('no-head.example.com')
    await expect(
      runVerify(
        db,
        { tenantId, siteId, requestId: 'r5' },
        {
          accessToken: async () => 'ya29.test',
          gsc: () => ({ listProperties: async () => [], addSite: async () => {} }),
          open: async () => {
            throw new VerificationInjectionError()
          },
          provider,
        },
      ),
    ).rejects.toThrow()
    expect((await siteRow(siteId)).gscVerificationError).toMatch(
      /Verify the site in Search Console directly/,
    )
  })

  it('clears the last failure when it is asked again, and when it then works', async () => {
    const siteId = await newSite('second-time-lucky.example.com')
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(sites)
        .set({ gscVerificationError: 'An earlier failure.' })
        .where(eq(sites.id, siteId)),
    )

    const accepted = await call('POST', `/sites/${siteId}/verify`)
    expect(accepted.statusCode).toBe(202)
    expect((await siteRow(siteId)).gscVerificationError).toBeNull()

    await runVerify(
      db,
      { tenantId, siteId, requestId: 'r6' },
      {
        accessToken: async () => 'ya29.test',
        gsc: () => ({
          listProperties: async () => [
            { siteUrl: 'sc-domain:second-time-lucky.example.com', permissionLevel: 'siteOwner' },
          ],
          addSite: never,
        }),
        open: never,
        provider,
      },
    )
    const row = await siteRow(siteId)
    expect(row.gscVerificationStatus).toBe('verified')
    expect(row.gscProperty).toBe('sc-domain:second-time-lucky.example.com')
  })
})

describe('verificationFailure', () => {
  it('has a sentence for each thing a person can act on, and none with an em dash', () => {
    const messages = [
      verificationFailure(new GoogleReauthRequiredError()),
      verificationFailure(new GoogleNotConnectedError()),
      verificationFailure(new VerificationInjectionError()),
      verificationFailure(new Error('anything else')),
    ]
    expect(new Set(messages).size).toBe(4)
    for (const message of messages) expect(message).not.toContain('—')
  })
})
