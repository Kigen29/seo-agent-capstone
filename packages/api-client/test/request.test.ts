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
})
