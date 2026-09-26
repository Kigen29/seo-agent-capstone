import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../src/index.js'

/** A fetch that records the request and returns an empty-ish OK JSON response. */
function recordingFetch(body: unknown = {}) {
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof globalThis.fetch
  return fetch as ReturnType<typeof vi.fn> & typeof globalThis.fetch
}

const headersOf = (fetch: ReturnType<typeof vi.fn>): Record<string, string> =>
  (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>

describe('the API client request', () => {
  it('does not declare a JSON content-type on a bodyless POST', async () => {
    // This is the production bug that took the dashboard down. The client used to set
    // content-type: application/json on every request. A POST with no body, like starting the
    // Google connection, then announced JSON with an empty body, and Fastify rejected it with
    // a 400 that the server action turned into a 500. The header must ride with the body.
    const fetch = recordingFetch({ url: 'https://accounts.google.com/...' })
    await createApiClient({ baseUrl: 'https://api.test', token: 't', fetch }).connectGoogle()

    const headers = headersOf(fetch)
    expect(headers['content-type']).toBeUndefined()
    expect(headers.authorization).toBe('Bearer t')
  })

  it('declares a JSON content-type when there is a body', async () => {
    const fetch = recordingFetch({ site: {} })
    await createApiClient({ baseUrl: 'https://api.test', token: 't', fetch }).addSite(
      'https://x.com',
    )

    expect(headersOf(fetch)['content-type']).toBe('application/json')
  })

  it('sends no content-type on a GET', async () => {
    const fetch = recordingFetch({ sites: [] })
    await createApiClient({ baseUrl: 'https://api.test', token: 't', fetch }).listSites()

    expect(headersOf(fetch)['content-type']).toBeUndefined()
  })

  it('carries the bearer token on every request', async () => {
    const fetch = recordingFetch({ google: { connected: false } })
    await createApiClient({ baseUrl: 'https://api.test', token: 'secret', fetch }).getConnections()

    expect(headersOf(fetch).authorization).toBe('Bearer secret')
  })

  it('resolves a 204 without trying to parse a body', async () => {
    // Revoking a credential and signing out both answer 204 with nothing in it. Parsing that
    // throws, and sign-out swallowed the throw for as long as it existed.
    const json = vi.fn(async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    })
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 204,
      json,
    })) as unknown as typeof globalThis.fetch
    const client = createApiClient({ baseUrl: 'https://api.test', token: 't', fetch })

    await expect(client.revokeCredential('abc')).resolves.toBeUndefined()
    await expect(client.signOut()).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://api.test/auth/tokens/abc')
    expect((init as RequestInit).method).toBe('DELETE')
  })
})
