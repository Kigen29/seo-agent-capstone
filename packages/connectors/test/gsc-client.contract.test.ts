import { describe, expect, it, vi } from 'vitest'
import {
  createGscClient,
  defaultWindow,
  GscAuthError,
  GscRateLimitError,
} from '../src/gsc/client.js'
import type { SearchAnalyticsQuery } from '../src/gsc/types.js'

/**
 * A contract test for Search Console: it pins the request we send and our reading of the
 * response, so a change on Google's side surfaces here rather than as an audit that quietly
 * reports no search data. The fetch is mocked; the shapes are Google's.
 */
const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)

describe('the Search Console client', () => {
  it('lists the verified properties', async () => {
    const fetch = respond(200, {
      siteEntry: [
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://blog.example.com/', permissionLevel: 'siteFullUser' },
      ],
    })
    const client = createGscClient({ accessToken: 'tok', fetch })

    const properties = await client.listProperties()

    expect(properties).toHaveLength(2)
    expect(properties[0]?.siteUrl).toBe('sc-domain:example.com')
  })

  it('sends the token as a bearer credential on every call', async () => {
    const fetch = respond(200, { siteEntry: [] })
    await createGscClient({ accessToken: 'secret-token', fetch }).listProperties()

    const headers = (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer secret-token')
  })

  it('adds a property with a PUT to the url-encoded path, and tolerates the 204', async () => {
    // sites.add returns 204 with no body; parsing that as JSON would throw. This pins both the
    // request shape and that an empty success is handled.
    const fetch = respond(204, {})
    await createGscClient({ accessToken: 'tok', fetch }).addSite('https://example.com/')

    const [url, init] = fetch.mock.calls[0]!
    expect((init as RequestInit).method).toBe('PUT')
    expect(url as string).toContain(encodeURIComponent('https://example.com/'))
  })

  it('url-encodes the property in the path, so sc-domain and https properties both work', async () => {
    // The usual cause of a spurious 404: `sc-domain:example.com` and `https://example.com/`
    // both contain characters that break a raw path. This asserts they are encoded.
    const fetch = respond(200, { rows: [] })
    const client = createGscClient({ accessToken: 'tok', fetch })

    await client.searchAnalytics('sc-domain:example.com', {
      startDate: '2026-06-01',
      endDate: '2026-06-28',
      dimensions: ['query'],
    })

    const url = fetch.mock.calls[0]![0] as string
    expect(url).toContain(encodeURIComponent('sc-domain:example.com'))
    expect(url).not.toContain('sc-domain:example.com/searchAnalytics') // i.e. not raw
  })

  it('returns the rows, and an empty list is a valid answer, not an error', async () => {
    const withRows = respond(200, {
      rows: [{ keys: ['seo audit'], clicks: 10, impressions: 200, ctr: 0.05, position: 8.2 }],
    })
    const empty = respond(200, {})

    const q: SearchAnalyticsQuery = {
      startDate: '2026-06-01',
      endDate: '2026-06-28',
      dimensions: ['query'],
    }

    expect(
      await createGscClient({ accessToken: 't', fetch: withRows }).searchAnalytics('p', q),
    ).toHaveLength(1)
    expect(
      await createGscClient({ accessToken: 't', fetch: empty }).searchAnalytics('p', q),
    ).toEqual([])
  })

  it('caps the row limit at Google hard ceiling', async () => {
    const fetch = respond(200, { rows: [] })
    await createGscClient({ accessToken: 't', fetch }).searchAnalytics('p', {
      startDate: '2026-06-01',
      endDate: '2026-06-28',
      dimensions: ['query'],
      rowLimit: 1_000_000,
    })

    const body = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.rowLimit).toBe(25_000)
  })

  it('raises a typed auth error on 401/403, so the caller can prompt re-consent', async () => {
    for (const status of [401, 403]) {
      const client = createGscClient({ accessToken: 't', fetch: respond(status, {}) })
      await expect(client.listProperties()).rejects.toBeInstanceOf(GscAuthError)
    }
  })

  it('raises a typed rate-limit error on 429', async () => {
    const client = createGscClient({ accessToken: 't', fetch: respond(429, {}) })
    await expect(client.listProperties()).rejects.toBeInstanceOf(GscRateLimitError)
  })
})

describe('defaultWindow', () => {
  it('ends three days back, because Search Console does not report the last two to three days', () => {
    // Ending "today" would pull in near-empty recent rows that read as a traffic cliff but are
    // only the reporting lag. The window ends three days ago on purpose.
    const now = new Date('2026-07-15T00:00:00Z')
    const { startDate, endDate } = defaultWindow(now)

    expect(endDate).toBe('2026-07-12')
    expect(startDate).toBe('2026-06-14') // 28 days before the end
  })
})
