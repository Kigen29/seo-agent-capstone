import { buildPrBody } from '@seo/vcs'
import type {
  FixPullRequest,
  PullRequest,
  RepoContext,
  RepoFile,
  VersionControlProvider,
} from '@seo/vcs'
import { describe, expect, it } from 'vitest'
import {
  confirmVerification,
  openVerificationPr,
  toUrlPrefixProperty,
  VerificationInjectionError,
  type PropertyClient,
  type VerificationClient,
} from '../src/verify.js'

/** A provider backed by an in-memory repo, capturing the PR it was asked to open. */
class FakeProvider implements VersionControlProvider {
  files = new Map<string, string>()
  opened?: FixPullRequest

  async getFile(_ctx: RepoContext, path: string): Promise<RepoFile | null> {
    const content = this.files.get(path)
    return content !== undefined ? { content, sha: 'sha' } : null
  }
  async openPullRequest(_ctx: RepoContext, input: FixPullRequest): Promise<PullRequest> {
    this.opened = input
    return { url: 'https://github.com/o/r/pull/9', number: 9, branch: 'seo-agent/x' }
  }
  async findOpenPullRequest(): Promise<PullRequest | null> {
    return null
  }
}

const repo: RepoContext = { repo: { owner: 'o', name: 'r' }, installationId: 1 }

// getMetaToken returns a complete <meta> tag, not just the value. The fix inserts it verbatim.
const META_TOKEN = '<meta name="google-site-verification" content="37PYOdaE9rgB1p7yc77" />'

function fakes(token = META_TOKEN, verified = false) {
  const calls: string[] = []
  const property: PropertyClient = {
    addSite: async (siteUrl) => {
      calls.push(`addSite:${siteUrl}`)
    },
  }
  const verification: VerificationClient = {
    getMetaToken: async (siteUrl) => {
      calls.push(`getMetaToken:${siteUrl}`)
      return token
    },
    verifyMeta: async () => verified,
  }
  return { property, verification, calls }
}

const SPA_INDEX =
  '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n'

describe('toUrlPrefixProperty', () => {
  it('normalises a site URL to the origin with a trailing slash', () => {
    expect(toUrlPrefixProperty('https://example.com')).toBe('https://example.com/')
    expect(toUrlPrefixProperty('https://example.com/pricing?x=1')).toBe('https://example.com/')
  })
})

describe('openVerificationPr', () => {
  it('creates the property, fetches the token, injects the tag, and opens a PR', async () => {
    const provider = new FakeProvider()
    provider.files.set('package.json', JSON.stringify({ dependencies: { react: '19.0.0' } }))
    provider.files.set('index.html', SPA_INDEX)
    const { property, verification, calls } = fakes()

    const result = await openVerificationPr(
      { siteId: 'site-1', siteUrl: 'https://example.com', repo },
      { property, verification, provider },
    )

    // Property and token were requested for the URL-prefix form.
    expect(calls).toContain('addSite:https://example.com/')
    expect(calls).toContain('getMetaToken:https://example.com/')

    // The PR writes Google's tag into index.html (react_spa -> spa-index), byte for byte, not
    // wrapped in another tag and not HTML-escaped.
    expect(provider.opened?.files[0]?.path).toBe('index.html')
    expect(provider.opened?.files[0]?.content).toContain(META_TOKEN)
    expect(provider.opened?.files[0]?.content).not.toContain('&lt;')

    expect(result).toMatchObject({
      property: 'https://example.com/',
      framework: 'react_spa',
      token: META_TOKEN,
      pr: { url: 'https://github.com/o/r/pull/9' },
    })
  })

  it('opens no PR and reports pr: null when the tag is already in the repo', async () => {
    // A merged PR, or a hand edit, means the tag is already present. Re-verifying must not error
    // or open a duplicate; it goes straight to confirmation.
    const provider = new FakeProvider()
    provider.files.set('package.json', JSON.stringify({ dependencies: { react: '19.0.0' } }))
    provider.files.set('index.html', SPA_INDEX.replace('</head>', `  ${META_TOKEN}\n  </head>`))
    const { property, verification } = fakes()

    const result = await openVerificationPr(
      { siteId: 'site-1', siteUrl: 'https://example.com', repo },
      { property, verification, provider },
    )

    expect(result.pr).toBeNull()
    expect(provider.opened).toBeUndefined() // no PR was opened
  })

  it('opens a PR whose synthetic finding is a valid, rule-4 body', async () => {
    const provider = new FakeProvider()
    provider.files.set('index.html', SPA_INDEX)
    const { property, verification } = fakes()

    await openVerificationPr(
      { siteId: 'site-1', siteUrl: 'https://example.com', repo },
      { property, verification, provider },
    )

    // The real vcs body builder throws if any of the five sections is missing. It does not here.
    const body = buildPrBody({
      finding: provider.opened!.finding,
      expectedEffect: provider.opened!.expectedEffect,
      rollback: provider.opened!.rollback,
    })
    expect(body).toContain('https://example.com/')
    expect(body).toContain('## How we will know if this failed')
  })

  it('throws when there is no head to inject into', async () => {
    const provider = new FakeProvider()
    provider.files.set('README.md', '# no head here')
    const { property, verification } = fakes()

    await expect(
      openVerificationPr(
        { siteId: 'site-1', siteUrl: 'https://example.com', repo },
        { property, verification, provider },
      ),
    ).rejects.toThrow(VerificationInjectionError)
  })
})

describe('confirmVerification', () => {
  it('returns what Google says: true when verified', async () => {
    const { verification } = fakes('t', true)
    expect(await confirmVerification('https://example.com/', verification)).toBe(true)
  })

  it('returns false while the tag is not live yet, without throwing', async () => {
    const { verification } = fakes('t', false)
    expect(await confirmVerification('https://example.com/', verification)).toBe(false)
  })
})
