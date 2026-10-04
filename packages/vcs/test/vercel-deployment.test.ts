import { describe, expect, it, vi } from 'vitest'
import { createVercelDeploymentLookup } from '../src/vercel-deployment.js'

const sha = 'a'.repeat(40)
const alias = { alias: 'site.example', projectId: 'prj_1', deploymentId: 'dpl_1', redirect: null }
const deployment = {
  id: 'dpl_1',
  projectId: 'prj_1',
  target: 'production',
  readyState: 'READY',
  aliasAssigned: true,
  aliasError: null,
  readySubstate: 'PROMOTED',
  gitSource: { type: 'github', repoId: 7, sha },
}
const lookup = (fetcher: typeof fetch) =>
  createVercelDeploymentLookup({ token: 'test-token', teamId: 'team_1', fetch: fetcher })
const provider = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (input: string | URL | Request) =>
    Response.json(
      new URL(String(input)).pathname.startsWith('/v4/aliases/')
        ? alias
        : { ...deployment, ...overrides },
    ),
  )

describe('Vercel deployment evidence', () => {
  it('uses the current domain assignment and confirms repository, target, and commit', async () => {
    const fetcher = provider()
    expect(await lookup(fetcher)('https://site.example', 7)).toEqual({ status: 'confirmed', sha })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit]
    expect(url.origin).toBe('https://api.vercel.com')
    expect(url.searchParams.get('teamId')).toBe('team_1')
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-token' })
  })

  it.each([
    { projectId: 'unrelated-project' },
    { id: 'unrelated-deployment' },
    { target: null },
    { target: 'staging' },
    { readyState: 'ERROR' },
    { readyState: 'BUILDING' },
    { aliasAssigned: false },
    { aliasError: { code: 'failed' } },
    { readySubstate: 'STAGED' },
    { readySubstate: 'ROLLING' },
    { gitSource: { type: 'github', repoId: 8, sha } },
    { gitSource: { type: 'gitlab', repoId: 7, sha } },
    { gitSource: { type: 'github', repoId: 7, sha: 'unknown' } },
    { gitSource: undefined },
  ])('does not confirm mismatched or incomplete deployment evidence: %j', async (overrides) => {
    expect(await lookup(provider(overrides))('https://site.example', 7)).toEqual({
      status: 'unconfirmed',
    })
  })

  it('refuses a domain served by a different project than the one the site connected', async () => {
    // The token can often see several projects. Only the one the customer named may confirm.
    const pinned = (projectId: string) =>
      createVercelDeploymentLookup({ token: 'test-token', projectId, fetch: provider() })

    expect(await pinned('prj_1')('https://site.example', 7)).toEqual({ status: 'confirmed', sha })
    expect(await pinned('prj_other')('https://site.example', 7)).toEqual({
      status: 'unconfirmed',
    })
  })

  it('reads the current rollback commit instead of searching for an older successful deployment', async () => {
    const rollback = 'b'.repeat(40)
    expect(
      await lookup(provider({ gitSource: { type: 'github', repoId: 7, sha: rollback } }))(
        'https://site.example',
        7,
      ),
    ).toEqual({ status: 'confirmed', sha: rollback })
    // GitHub ancestry subsequently decides whether this current commit includes the merge.
  })

  it('refuses a domain that is reassigned while its deployment is being read', async () => {
    let reads = 0
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname.startsWith('/v4/aliases/'))
        return Response.json(++reads === 1 ? alias : { ...alias, deploymentId: 'dpl_old' })
      return Response.json(deployment)
    })
    expect(await lookup(fetcher)('https://site.example', 7)).toEqual({ status: 'unconfirmed' })
  })

  it('follows a provider-confirmed apex-to-www redirect within the same project', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path === '/v4/aliases/site.example')
        return Response.json({ ...alias, deploymentId: null, redirect: 'www.site.example' })
      if (path === '/v4/aliases/www.site.example')
        return Response.json({ ...alias, alias: 'www.site.example' })
      return Response.json(deployment)
    })
    expect(await lookup(fetcher)('https://site.example', 7)).toEqual({ status: 'confirmed', sha })
  })

  it.each([
    { alias: 'another.example' },
    { deletedAt: 123 },
    { projectId: null },
    { microfrontends: {} },
    { redirect: 'other.example' },
    { redirect: 'http://www.site.example' },
  ])('declines ambiguous alias routing: %j', async (overrides) => {
    const fetcher = vi.fn(async () => Response.json({ ...alias, ...overrides }))
    expect(await lookup(fetcher)('https://site.example', 7)).toEqual({ status: 'unconfirmed' })
  })

  it('distinguishes an unknown alias from unreadable provider evidence', async () => {
    expect(
      await lookup(async () => new Response(null, { status: 404 }))('https://site.example', 7),
    ).toEqual({ status: 'not-found' })
    for (const status of [401, 403, 429, 500])
      expect(
        await lookup(async () => new Response(null, { status }))('https://site.example', 7),
      ).toEqual({ status: 'unconfirmed' })
    expect(
      await lookup(async () => {
        throw new Error('secret response must not escape')
      })('https://site.example', 7),
    ).toEqual({ status: 'unconfirmed' })
  })

  it('does not make credentialed requests for insecure or nonstandard site origins', async () => {
    const fetcher = provider()
    for (const url of [
      'http://site.example',
      'https://site.example:8443',
      'https://user:pass@site.example',
    ])
      expect(await lookup(fetcher)(url, 7)).toEqual({ status: 'unconfirmed' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
