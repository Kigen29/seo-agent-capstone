import { describe, expect, it } from 'vitest'
import {
  exchangeVercelCode,
  findVercelProjects,
  vercelConsentUrl,
  type VercelIntegration,
} from '../src/vercel-connect.js'

/**
 * Connecting Vercel by consent. A contract test against Vercel's documented API, with the network
 * replaced: what is asserted is what we send (the right endpoint, the secret in the body and never
 * in the address) and that we believe only what a response actually says.
 */
const integration: VercelIntegration = {
  clientId: 'oac_client',
  clientSecret: 'shh-client-secret',
  slug: 'rankwright',
  redirectUri: 'https://api.example.com/connections/vercel/callback',
}

interface Seen {
  url: string
  init: RequestInit | undefined
}

const fakeFetch = (status: number, body: unknown, seen: Seen[] = []) =>
  (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seen.push({ url: String(input), init })
    return new Response(JSON.stringify(body), { status })
  }) as typeof globalThis.fetch

describe('vercelConsentUrl', () => {
  it('sends the browser to the integration, carrying the state', () => {
    const url = new URL(vercelConsentUrl(integration, 'signed.state'))

    expect(url.origin + url.pathname).toBe('https://vercel.com/integrations/rankwright/new')
    expect(url.searchParams.get('state')).toBe('signed.state')
  })
})

describe('exchangeVercelCode', () => {
  it('posts the code and the secret in the body, and returns the token and team', async () => {
    const seen: Seen[] = []
    const grant = await exchangeVercelCode(
      integration,
      'the-code',
      fakeFetch(200, { access_token: 'tok_1', team_id: 'team_9' }, seen),
    )

    expect(grant).toEqual({ token: 'tok_1', teamId: 'team_9' })
    expect(seen[0]!.url).toBe('https://api.vercel.com/v2/oauth/access_token')
    // The secret travels in the form body. An address is logged by every proxy on the way.
    expect(seen[0]!.url).not.toContain('shh-client-secret')
    const body = new URLSearchParams(String(seen[0]!.init?.body))
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'oac_client',
      client_secret: 'shh-client-secret',
      code: 'the-code',
      redirect_uri: integration.redirectUri,
    })
  })

  it('has no team for a personal account', async () => {
    const grant = await exchangeVercelCode(
      integration,
      'c',
      fakeFetch(200, { access_token: 'tok_1', team_id: null }),
    )

    expect(grant).toEqual({ token: 'tok_1' })
  })

  it('throws when Vercel refuses, without repeating what Vercel said', async () => {
    await expect(
      exchangeVercelCode(integration, 'c', fakeFetch(400, { error: 'details tok_leak' })),
    ).rejects.toThrow(/refused the code exchange \(400\)/)
  })

  it('throws when a success carries no token', async () => {
    await expect(exchangeVercelCode(integration, 'c', fakeFetch(200, {}))).rejects.toThrow(
      /no access token/,
    )
  })
})

describe('findVercelProjects', () => {
  const linked = (id: string, org: string, repo: string, type = 'github') => ({
    id,
    name: `name-${id}`,
    link: { type, org, repo },
  })

  it('asks for projects of the repository, in the team, with the token as a bearer', async () => {
    const seen: Seen[] = []
    await findVercelProjects(
      { token: 'tok_1', teamId: 'team_9', repoFullName: 'Octo/Site' },
      fakeFetch(200, [], seen),
    )

    const url = new URL(seen[0]!.url)
    expect(url.pathname).toBe('/v10/projects')
    expect(url.searchParams.get('repoUrl')).toBe('https://github.com/Octo/Site')
    expect(url.searchParams.get('teamId')).toBe('team_9')
    expect(new Headers(seen[0]!.init?.headers).get('authorization')).toBe('Bearer tok_1')
  })

  it('reads either shape of answer', async () => {
    const one = [linked('prj_a', 'octo', 'site')]

    expect(
      await findVercelProjects({ token: 't', repoFullName: 'octo/site' }, fakeFetch(200, one)),
    ).toEqual([{ id: 'prj_a', name: 'name-prj_a' }])
    expect(
      await findVercelProjects(
        { token: 't', repoFullName: 'octo/site' },
        fakeFetch(200, { projects: one, pagination: {} }),
      ),
    ).toEqual([{ id: 'prj_a', name: 'name-prj_a' }])
  })

  it('keeps only projects whose own record names this repository on GitHub', async () => {
    const found = await findVercelProjects(
      { token: 't', repoFullName: 'octo/site' },
      fakeFetch(200, [
        linked('prj_other', 'octo', 'another'),
        linked('prj_gitlab', 'octo', 'site', 'gitlab'),
        { id: 'prj_unlinked', name: 'unlinked' },
        linked('prj_yes', 'Octo', 'Site'),
        linked('prj_also', 'octo', 'site'),
      ]),
    )

    // Two, in the order given: a repository can deploy to more than one project.
    expect(found.map((project) => project.id)).toEqual(['prj_yes', 'prj_also'])
  })

  it('throws when Vercel refuses the listing', async () => {
    await expect(
      findVercelProjects({ token: 't', repoFullName: 'octo/site' }, fakeFetch(403, {})),
    ).rejects.toThrow(/refused to list projects \(403\)/)
  })

  it('finds nothing in an answer it does not recognise', async () => {
    expect(
      await findVercelProjects(
        { token: 't', repoFullName: 'octo/site' },
        fakeFetch(200, { nope: 1 }),
      ),
    ).toEqual([])
  })
})
