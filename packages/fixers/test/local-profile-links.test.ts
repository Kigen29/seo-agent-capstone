import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { LocalProfileLinksFixer } from '../src/fixers/local-profile-links.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

const PROFILE = 'https://maps.google.com/?cid=1234567890123456789'

/** A LOCAL-002 finding carrying the profile link the rule decoded. */
function finding(snippet?: string, overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'LOCAL-002',
    axis: 'local',
    severity: 'low',
    title: 'LocalBusiness markup does not link to the Google Business Profile',
    affectedUrls: ['https://ex.com/'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'script[type="application/ld+json"] LocalBusiness',
      snippet: snippet ?? JSON.stringify({ profileUrl: PROFILE, missing: ['hasMap', 'sameAs'] }),
      observedAt: '2026-09-20T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

const layoutWith = (block: unknown) => `export default function Layout() {
  return (
    <html>
      <head>
        <title>Acme Cafe</title>
        <script type="application/ld+json">
${JSON.stringify(block, null, 2)}
        </script>
      </head>
    </html>
  )
}
`

const BUSINESS = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Acme Cafe',
  telephone: '+254700000000',
}

const fixer = new LocalProfileLinksFixer()

const generate = (files: Record<string, string>, f = finding()) =>
  fixer.generate({ finding: f, framework: 'next', read: reader(files) })

describe('LocalProfileLinksFixer', () => {
  it('adds hasMap and sameAs to the existing LocalBusiness node', async () => {
    const result = await generate({ 'app/layout.tsx': layoutWith(BUSINESS) })

    expect(result?.files).toHaveLength(1)
    const written = JSON.parse(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        result!.files[0]!.content,
      )![1]!,
    )
    expect(written.hasMap).toBe(PROFILE)
    expect(written.sameAs).toEqual([PROFILE])
    // The rest of the node is untouched, which is what "edit" has to mean here.
    expect(written.name).toBe('Acme Cafe')
    expect(written.telephone).toBe('+254700000000')
  })

  it('edits the block rather than adding a second one', async () => {
    // Two LocalBusiness blocks describe two businesses, so this is the failure that would make
    // the fix worse than the finding.
    const result = await generate({ 'app/layout.tsx': layoutWith(BUSINESS) })

    const blocks = result!.files[0]!.content.match(/application\/ld\+json/g)
    expect(blocks).toHaveLength(1)
  })

  it('finds the business inside an @graph container', async () => {
    const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, BUSINESS] }

    const result = await generate({ 'app/layout.tsx': layoutWith(graph) })

    expect(result?.files[0]?.content).toContain(PROFILE)
  })

  it('leaves a property the site already set alone', async () => {
    const owned = { ...BUSINESS, sameAs: ['https://facebook.com/acme'] }

    const result = await generate({ 'app/layout.tsx': layoutWith(owned) })

    const written = JSON.parse(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        result!.files[0]!.content,
      )![1]!,
    )
    expect(written.sameAs).toEqual(['https://facebook.com/acme'])
    expect(written.hasMap).toBe(PROFILE)
  })

  it('changes nothing when both links are already there', async () => {
    const linked = { ...BUSINESS, hasMap: PROFILE, sameAs: [PROFILE] }

    expect(await generate({ 'app/layout.tsx': layoutWith(linked) })).toBeNull()
  })

  it('produces nothing when the markup is not in a file we can name', async () => {
    // A plugin or CMS generates it. Null here means the fix job records why and the finding
    // keeps its guidance, which is the honest outcome rather than a PR that misses the mark.
    expect(
      await generate({ 'app/layout.tsx': '<html><head><title>x</title></head></html>' }),
    ).toBeNull()
  })

  it('leaves a JSON-LD block it cannot parse completely alone', async () => {
    const broken = `<html><head><script type="application/ld+json">{ not json }</script></head></html>`

    expect(await generate({ 'app/layout.tsx': broken })).toBeNull()
  })

  it('refuses a finding whose evidence is not a Maps profile link', async () => {
    // Whatever produced it, an arbitrary URL is not something to write into a client's markup.
    const hostile = finding(JSON.stringify({ profileUrl: 'https://evil.example/?cid=1' }))

    expect(fixer.canFix(hostile)).toBe(false)
    expect(await generate({ 'app/layout.tsx': layoutWith(BUSINESS) }, hostile)).toBeNull()
  })

  it('only claims findings it owns', () => {
    expect(fixer.canFix(finding())).toBe(true)
    expect(fixer.canFix(makeFinding({ ruleId: 'LOCAL-001' }))).toBe(false)
  })
})
