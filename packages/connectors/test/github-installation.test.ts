import { describe, expect, it, vi } from 'vitest'
import { verifyGitHubInstallationAccess } from '../src/identity/github-installation.js'
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
