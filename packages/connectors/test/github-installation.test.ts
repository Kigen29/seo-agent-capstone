import { describe, expect, it, vi } from 'vitest'
import {
  listGitHubUserInstallations,
  verifyGitHubInstallationAccess,
} from '../src/identity/github-installation.js'
describe('installation authorization', () => {
  it.each([403, 404])('refuses an installation the user cannot access (%s)', async (status) => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'test-token' }))
      .mockResolvedValueOnce(new Response(null, { status }))
    expect(
      await verifyGitHubInstallationAccess('code', 42, {
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'https://app.example/callback',
        fetch: http,
      }),
    ).toBe(false)
  })
  it('uses the exchanged user token, not an installation token', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'user-token' }))
      .mockResolvedValueOnce(Response.json({ repositories: [] }))
    expect(
      await verifyGitHubInstallationAccess('code', 42, {
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'https://app.example/callback',
        fetch: http,
      }),
    ).toBe(true)
    expect(http.mock.calls[1]?.[1].headers.authorization).toBe('Bearer user-token')
  })
})

describe('installation discovery', () => {
  const options = (http: ReturnType<typeof vi.fn>) => ({
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/callback',
    fetch: http as unknown as typeof globalThis.fetch,
  })

  it('lists the installations the signed-in user can reach, with their user token', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'user-token' }))
      .mockResolvedValueOnce(Response.json({ installations: [{ id: 42 }, { id: 'x' }, { id: 7 }] }))
    expect(await listGitHubUserInstallations('code', options(http))).toEqual([42, 7])
    expect(http.mock.calls[1]?.[0]).toBe('https://api.github.com/user/installations?per_page=100')
    expect(http.mock.calls[1]?.[1].headers.authorization).toBe('Bearer user-token')
  })

  it('reports none as an empty list, and a refused exchange as unknown', async () => {
    const none = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'user-token' }))
      .mockResolvedValueOnce(Response.json({ installations: [] }))
    expect(await listGitHubUserInstallations('code', options(none))).toEqual([])

    const refused = vi.fn().mockResolvedValueOnce(Response.json({ error: 'bad_verification_code' }))
    expect(await listGitHubUserInstallations('code', options(refused))).toBeUndefined()
  })
})
