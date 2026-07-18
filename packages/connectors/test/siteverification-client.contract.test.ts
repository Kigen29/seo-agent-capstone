import { describe, expect, it, vi } from 'vitest'
import {
  createSiteVerificationClient,
  META_TAG_NAME,
  SiteVerificationAuthError,
} from '../src/siteverification/client.js'

/**
 * A contract test for the Site Verification API: it pins the requests we send and our reading
 * of the responses, so a change on Google's side surfaces here rather than as a verification
 * that silently never completes. The fetch is mocked; the shapes are Google's.
 */
const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)

const SITE = 'https://example.com/'

describe('the Site Verification client', () => {
  it('gets a META token for a URL-prefix site', async () => {
    const fetch = respond(200, { method: 'META', token: 'tok-abc-123' })
    const token = await createSiteVerificationClient({ accessToken: 't', fetch }).getMetaToken(SITE)

    expect(token).toBe('tok-abc-123')

    const [url, init] = fetch.mock.calls[0]!
    expect(url as string).toContain('/token')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.verificationMethod).toBe('META')
    expect(body.site).toEqual({ type: 'SITE', identifier: SITE })
  })

  it('throws when Google returns no token', async () => {
    const fetch = respond(200, { method: 'META' })
    await expect(
      createSiteVerificationClient({ accessToken: 't', fetch }).getMetaToken(SITE),
    ).rejects.toThrow(/no token/)
  })

  it('verifies via META and reports true on success', async () => {
    const fetch = respond(200, { id: 'x', site: { identifier: SITE }, owners: ['me@example.com'] })
    const ok = await createSiteVerificationClient({ accessToken: 't', fetch }).verifyMeta(SITE)

    expect(ok).toBe(true)
    const [url, init] = fetch.mock.calls[0]!
    expect(url as string).toContain('/webResource?verificationMethod=META')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('reports false, not an error, when the tag is not found yet (400)', async () => {
    // The normal state before the PR is merged and the tag is live. A caller polls; it is not
    // a crash.
    const fetch = respond(400, { error: { message: 'Required meta tag not found.' } })
    const ok = await createSiteVerificationClient({ accessToken: 't', fetch }).verifyMeta(SITE)
    expect(ok).toBe(false)
  })

  it('throws SiteVerificationAuthError on 401 and 403', async () => {
    for (const status of [401, 403]) {
      const fetch = respond(status, {})
      await expect(
        createSiteVerificationClient({ accessToken: 't', fetch }).getMetaToken(SITE),
      ).rejects.toThrow(SiteVerificationAuthError)
    }
  })

  it('throws on an unexpected verify failure', async () => {
    const fetch = respond(500, { error: 'boom' })
    await expect(
      createSiteVerificationClient({ accessToken: 't', fetch }).verifyMeta(SITE),
    ).rejects.toThrow(/Verification failed/)
  })

  it('sends the token as a bearer credential', async () => {
    const fetch = respond(200, { token: 'x' })
    await createSiteVerificationClient({ accessToken: 'secret', fetch }).getMetaToken(SITE)

    const headers = (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer secret')
  })

  it('exposes the meta tag name Google reads', () => {
    expect(META_TAG_NAME).toBe('google-site-verification')
  })
})
