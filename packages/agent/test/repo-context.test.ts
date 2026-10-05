import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_SIZES,
  evidenceNeedles,
  fitContext,
  isReadable,
  looksLikeItHoldsACredential,
  pathScore,
  rankCandidates,
  selectContext,
  shortlist,
  urlTokens,
  type TreeEntry,
} from '../src/repo-context.js'

/**
 * What the agent may read from a client's repository, and what it chooses to.
 *
 * The first half of this file is a security boundary and is tested like one: each line names a
 * real file from a real repository that must never reach a model. The second half is the ranking,
 * tested against the layout of the two sites this was built on, because "it picked plausible
 * files" is not something a made-up tree can show.
 */

const file = (path: string, size = 2_000): TreeEntry => ({ path, size })

const finding = (over: Partial<Finding> = {}): Finding =>
  ({
    id: 'TECH-023#0',
    siteId: 'site-1',
    ruleId: 'TECH-023',
    axis: 'crawl_health',
    severity: 'critical',
    confidence: 0.95,
    title: '3 different pages all declare https://www.example.com/ as their canonical',
    evidence: {
      kind: 'markup',
      url: 'https://www.example.com/about',
      locator: 'link[rel="canonical"]',
      snippet: '<link rel="canonical" href="https://www.example.com/">',
      observedAt: '2026-10-05T00:00:00.000Z',
      source: 'crawler',
    },
    affectedUrls: [
      'https://www.example.com/about',
      'https://www.example.com/destinations/amboseli',
    ],
    estimatedEffort: 'small',
    estimatedImpact: 95,
    falsification: 'Re-fetch two of the pages; if each names itself, this was wrong.',
    fixable: true,
    status: 'open',
    ...over,
  }) as Finding

describe('isReadable: what may be read, shown to a model, or written', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    '.env.example',
    'apps/web/.env',
    '.github/workflows/ci.yml',
    '.mcp.json',
    '.npmrc',
    'package-lock.json',
    'pnpm-lock.yaml',
    'node_modules/react/index.js',
    'dist/assets/index-abc.js',
    '.next/server/app.js',
    'src/integrations/supabase/client.ts',
    'supabase/functions/send-email/index.ts',
    'secrets/production.ts',
    'config/credentials.ts',
    'keys/deploy.pem',
    'certs/server.key',
    'id_rsa',
    'e2e/homepage.spec.ts',
    'src/components/Button.test.tsx',
    'src/types/api.d.ts',
    'public/vendor.min.js',
  ])('refuses %s', (path) => {
    expect(isReadable(file(path))).toBe(false)
  })

  it.each([
    'index.html',
    'src/App.tsx',
    'src/components/SEO.tsx',
    'src/pages/about/VisionMission.tsx',
    'app/layout.tsx',
    'src/routes/+layout.svelte',
    'public/robots.txt',
    'public/sitemap.xml',
    'public/_redirects',
    'vercel.json',
    'netlify.toml',
    'content/blog/first-post.mdx',
  ])('reads %s', (path) => {
    expect(isReadable(file(path))).toBe(true)
  })

  it('refuses data and config JSON, reading only the files that configure hosting', () => {
    expect(isReadable(file('package.json'))).toBe(false)
    expect(isReadable(file('tsconfig.json'))).toBe(false)
    expect(isReadable(file('src/data/customers.json'))).toBe(false)
    expect(isReadable(file('vercel.json'))).toBe(true)
  })

  it('refuses anything too large to be hand-written source, and anything binary', () => {
    expect(isReadable(file('src/generated/schema.ts', 400_000))).toBe(false)
    expect(isReadable(file('public/hero.jpg', 4_000))).toBe(false)
    expect(isReadable(file('public/intro.mp4', 4_000))).toBe(false)
  })
})

/**
 * Assembled at run time, never written out. A literal shaped like a live key would be flagged by
 * the repository's own secret scanner, correctly, and these are shapes, not secrets.
 */
const filler = (length: number, seed = 'a1B2c3D4e5F6g7H8') =>
  seed.repeat(Math.ceil(length / seed.length)).slice(0, length)
const jwtLike = ['ey' + 'J' + filler(24), 'ey' + 'J' + filler(24), filler(22)].join('.')

describe('looksLikeItHoldsACredential', () => {
  it.each([
    ['a JWT', `const key = "${jwtLike}"`],
    ['a Stripe-style key', `stripe("${'sk' + '_live_' + filler(24)}")`],
    ['an OpenAI-style key', `apiKey: "${'sk' + '-' + filler(32)}"`],
    ['an AWS key id', 'AK' + 'IA' + filler(16, 'ABCDEFGH23456789')],
    ['a Google API key', `key=${'AI' + 'za' + filler(35)}`],
    ['a GitHub token', 'gh' + 'p_' + filler(36)],
    ['a private key', ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')],
    ['an assigned secret', `const API_KEY = "${filler(32)}"`],
  ])('withholds a file containing %s', (_label, content) => {
    expect(looksLikeItHoldsACredential(content)).toBe(true)
  })

  it('does not withhold ordinary page source', () => {
    const page =
      'export default function About() {\n  const title = "About our walking tours"\n' +
      '  return <SEO title={title} description="Family-run tours since 1998" />\n}\n'

    expect(looksLikeItHoldsACredential(page)).toBe(false)
  })
})

describe('urlTokens', () => {
  it('turns URL paths into the words a file would be named with', () => {
    expect(urlTokens(['https://x.example/about/vision-mission']).sort()).toEqual([
      'about',
      'mission',
      'vision',
      'visionmission',
    ])
  })

  it('ignores record ids, which name a row and not a file', () => {
    expect(urlTokens(['https://x.example/safaris/82695b94-7ee5-4096-8f69-209348c0ae7b'])).toEqual([
      'safaris',
    ])
  })
})

/** The shape both real sites have: a Vite React app with a shared SEO component. */
const TREE: TreeEntry[] = [
  file('.env'),
  file('index.html'),
  file('package.json'),
  file('public/robots.txt', 200),
  file('public/sitemap.xml'),
  file('src/App.tsx', 9_000),
  file('src/main.tsx', 200),
  file('src/components/SEO.tsx', 1_500),
  file('src/components/layout/Header.tsx', 10_000),
  file('src/components/layout/Footer.tsx', 7_000),
  file('src/components/ui/accordion.tsx'),
  file('src/components/ui/button.tsx'),
  file('src/components/admin/AdminSidebar.tsx'),
  file('src/hooks/use-toast.ts'),
  file('src/integrations/supabase/client.ts', 600),
  file('src/pages/About.tsx', 6_000),
  file('src/pages/Index.tsx', 1_100),
  file('src/pages/Contact.tsx', 9_000),
  file('src/pages/destinations/Amboseli.tsx', 5_000),
  file('src/pages/destinations/Serengeti.tsx', 5_000),
]

describe('shortlist', () => {
  it('puts the affected pages and the shared head and router files first', () => {
    const top = shortlist(TREE, finding()).slice(0, 7)

    expect(top).toContain('src/pages/destinations/Amboseli.tsx')
    expect(top).toContain('src/pages/About.tsx')
    expect(top).toContain('index.html')
    expect(top).toContain('src/App.tsx')
    expect(top).toContain('src/components/SEO.tsx')
  })

  it('never lists a file the agent may not read', () => {
    const all = shortlist(TREE, finding(), 100)

    expect(all).not.toContain('.env')
    expect(all).not.toContain('package.json')
    expect(all).not.toContain('src/integrations/supabase/client.ts')
  })

  it('ranks the crawl files first only for a rule that is about them', () => {
    const forCanonical = shortlist(TREE, finding())
    const forSitemap = shortlist(TREE, finding({ ruleId: 'TECH-004' }))

    expect(forSitemap.indexOf('public/sitemap.xml')).toBeLessThan(3)
    expect(forCanonical.indexOf('public/sitemap.xml')).toBeGreaterThan(
      forCanonical.indexOf('src/components/SEO.tsx'),
    )
  })

  it('prefers the homepage file when the finding is about the homepage', () => {
    const top = shortlist(
      TREE,
      finding({ ruleId: 'TECH-019', affectedUrls: ['https://www.example.com/'] }),
    )

    expect(top.indexOf('src/pages/Index.tsx')).toBeLessThan(top.indexOf('src/pages/Contact.tsx'))
  })

  it('is the same list every time, whatever order the tree arrives in', () => {
    expect(shortlist([...TREE].reverse(), finding())).toEqual(shortlist(TREE, finding()))
  })
})

describe('evidenceNeedles', () => {
  it('pulls out what the audit observed, so the file that contains it can be found', () => {
    expect(evidenceNeedles(finding())).toContain('https://www.example.com/')
  })

  it('uses the subject of a grouped finding, such as a shared title', () => {
    const needles = evidenceNeedles(
      finding({ ruleId: 'TECH-011', subject: 'Best Safari Tours | Example Safaris' }),
    )

    expect(needles).toContain('Best Safari Tours | Example Safaris')
  })
})

describe('selectContext', () => {
  const CONTENTS: Record<string, string> = {
    'index.html':
      '<!doctype html><html lang="en"><head><link rel="canonical" href="https://www.example.com/"></head><body><div id="root"></div></body></html>',
    'src/App.tsx': 'export default function App() { return <Routes>{/* routes */}</Routes> }',
    'src/components/SEO.tsx':
      'export function SEO({ title }) { return <Helmet><title>{title}</title></Helmet> }',
    'src/pages/About.tsx': 'export default function About() { return <h1>About</h1> }',
    'src/pages/destinations/Amboseli.tsx':
      'export default function Amboseli() { return <h1>Amboseli</h1> }',
    'src/components/layout/Header.tsx': `const anon = "${jwtLike}"`,
  }
  const reads: string[] = []
  const read = async (path: string) => {
    reads.push(path)
    return CONTENTS[path] ?? `// ${path}`
  }

  it('puts the file that contains what the audit observed first', async () => {
    const context = await selectContext(TREE, finding(), read)

    // index.html holds the literal canonical the finding quotes.
    expect(context.files[0]?.path).toBe('index.html')
  })

  it('withholds a file whose contents look like a credential, and says so', async () => {
    const context = await selectContext(TREE, finding(), read)

    expect(context.withheld).toEqual(['src/components/layout/Header.tsx'])
    expect(context.files.map((f) => f.path)).not.toContain('src/components/layout/Header.tsx')
    // Not offered for a second look either.
    expect(context.otherPaths).not.toContain('src/components/layout/Header.tsx')
  })

  it('never even opens a file it may not read', async () => {
    reads.length = 0
    await selectContext(TREE, finding(), read)

    expect(reads).not.toContain('.env')
    expect(reads).not.toContain('src/integrations/supabase/client.ts')
  })

  it('reads a file the model asked for, but only through the same checks', async () => {
    const context = await selectContext(TREE, finding(), read, {
      also: [
        'src/pages/Contact.tsx',
        '.env',
        'src/integrations/supabase/client.ts',
        'not/in/tree.ts',
      ],
    })

    expect(context.files[0]?.path).toBe('src/pages/Contact.tsx')
    expect(context.files.map((f) => f.path)).not.toContain('.env')
    expect(reads).not.toContain('not/in/tree.ts')
  })

  it('stays inside its budget on a large repository', async () => {
    const big: TreeEntry[] = Array.from({ length: 300 }, (_, i) =>
      file(`src/pages/Page${i}.tsx`, 20_000),
    )
    const context = await selectContext(big, finding(), async () => 'x'.repeat(20_000))

    const total = context.files.reduce((sum, f) => sum + f.content.length, 0)
    expect(total).toBeLessThanOrEqual(CONTEXT_SIZES[0]!.chars)
    expect(context.files.length).toBeLessThanOrEqual(CONTEXT_SIZES[0]!.files)
  })
})

/**
 * Found by running the selector against the real repository of a real site, with no model
 * involved. Each of these is something it got wrong there.
 */
describe('ranking, as corrected against a real repository', () => {
  const SAFARI: TreeEntry[] = [
    file('index.html'),
    file('src/App.tsx'),
    file('src/main.tsx'),
    file('src/components/SEO.tsx'),
    file('src/components/admin/AdminLayout.tsx'),
    file('src/components/Layout.tsx'),
    file('src/pages/About.tsx'),
    file('src/pages/Contact.tsx'),
    file('src/pages/Destinations.tsx'),
    file('src/pages/destinations/Amboseli.tsx'),
    file('src/pages/destinations/Samburu.tsx'),
    file('src/pages/destinations/LakeNakuru.tsx'),
    file('app/destinations/page.tsx'),
  ]
  const about = (ruleId: string) =>
    finding({
      ruleId,
      affectedUrls: ['https://www.example.com/destinations', 'https://www.example.com/about'],
    })

  it('reads /destinations as the destinations page, not every file in a destinations folder', () => {
    const list = shortlist(SAFARI, about('TECH-026'))

    expect(list.indexOf('src/pages/Destinations.tsx')).toBeLessThan(
      list.indexOf('src/pages/destinations/Amboseli.tsx'),
    )
    expect(pathScore('src/pages/destinations/Samburu.tsx', about('TECH-026'))).toBeLessThan(
      pathScore('src/pages/About.tsx', about('TECH-026')),
    )
  })

  it('still treats a folder as the page when the framework names every route file the same', () => {
    expect(pathScore('app/destinations/page.tsx', about('TECH-026'))).toBeGreaterThan(
      pathScore('src/pages/destinations/Samburu.tsx', about('TECH-026')),
    )
  })

  it('puts the head component and the document above any page for a rule fixed in the head', () => {
    expect(shortlist(SAFARI, about('TECH-026')).slice(0, 2).sort()).toEqual([
      'index.html',
      'src/components/SEO.tsx',
    ])
    // A heading is fixed in the page, so there the page wins.
    expect(pathScore('src/pages/About.tsx', about('TECH-019'))).toBeGreaterThan(
      pathScore('src/components/SEO.tsx', about('TECH-019')),
    )
  })

  it('does not offer the admin layout as the place to add a main landmark', () => {
    const list = shortlist(SAFARI, about('AGENT-002'))

    expect(list.indexOf('src/components/Layout.tsx')).toBeLessThan(
      list.indexOf('src/components/admin/AdminLayout.tsx'),
    )
    expect(list.indexOf('src/components/admin/AdminLayout.tsx')).toBeGreaterThan(5)
  })

  it('does not let one long page crowd out the small file the fix belongs in', async () => {
    const sizes: Record<string, number> = {
      'src/pages/Destinations.tsx': 26_000,
      'src/pages/Contact.tsx': 22_000,
      'src/pages/About.tsx': 13_000,
    }
    const read = async (path: string) =>
      `// ${path}\nconst description = 1\n` + 'x'.repeat(sizes[path] ?? 2_000)

    const context = await selectContext(SAFARI, about('TECH-026'), read)
    const paths = context.files.map((f) => f.path)

    expect(paths.slice(0, 2).sort()).toEqual(['index.html', 'src/components/SEO.tsx'])
    expect(paths).toContain('index.html')
    expect(paths).toContain('src/App.tsx')
    // Over two fifths of the budget and not known to contain the evidence: left for a request.
    expect(paths).not.toContain('src/pages/Destinations.tsx')
    expect(context.otherPaths).toContain('src/pages/Destinations.tsx')
  })
})

describe('fitContext: one ranking, cut to more than one size', () => {
  const tree: TreeEntry[] = Array.from({ length: 40 }, (_, i) => file(`src/pages/Page${i}.tsx`))
  const read = async (path: string) => `// ${path}\n` + 'x'.repeat(1_500)

  it('shrinks the files, their total size and the list of other paths together', async () => {
    const ranked = await rankCandidates(tree, finding(), read)

    const sizes = CONTEXT_SIZES.map((limits) => fitContext(ranked, limits))
    const chars = sizes.map((c) => c.files.reduce((sum, f) => sum + f.content.length, 0))

    sizes.forEach((context, i) => {
      expect(context.files.length).toBeLessThanOrEqual(CONTEXT_SIZES[i]!.files)
      expect(chars[i]).toBeLessThanOrEqual(CONTEXT_SIZES[i]!.chars)
      expect(context.otherPaths.length).toBeLessThanOrEqual(CONTEXT_SIZES[i]!.otherPaths)
    })
    expect(chars[2]).toBeLessThan(chars[1]!)
    expect(chars[1]).toBeLessThan(chars[0]!)
    expect(sizes[2]!.files.length).toBeGreaterThan(0)
  })

  it('keeps the best files when it shrinks, in the same order', async () => {
    const ranked = await rankCandidates(tree, finding(), read)
    const large = fitContext(ranked, CONTEXT_SIZES[0]).files.map((f) => f.path)
    const small = fitContext(ranked, CONTEXT_SIZES[2]).files.map((f) => f.path)

    expect(large.slice(0, small.length)).toEqual(small)
  })

  it('reads nothing when it is cut again', async () => {
    let reads = 0
    const ranked = await rankCandidates(tree, finding(), async (path) => {
      reads += 1
      return read(path)
    })
    const before = reads

    fitContext(ranked, CONTEXT_SIZES[1])
    fitContext(ranked, CONTEXT_SIZES[2])

    expect(reads).toBe(before)
  })
})

describe('evidence that is everywhere points nowhere', () => {
  const tree: TreeEntry[] = [
    file('index.html'),
    file('src/components/StructuredData.tsx'),
    file('src/pages/About.tsx'),
    file('src/pages/Services.tsx'),
    file('src/pages/Tours.tsx'),
    file('src/pages/Contact.tsx'),
  ]
  const site = 'https://www.example.com/'

  it('does not let the site address outrank the file that holds the tag', async () => {
    // The address is in every page; only the shell has the canonical tag the audit observed.
    const read = async (path: string) =>
      path === 'index.html'
        ? `<html><head><link rel="canonical" href="${site}" /></head></html>`
        : `export const url = "${site}"\n// ${path}`

    const ranked = await rankCandidates(tree, finding({ affectedUrls: [`${site}tours`] }), read)

    expect(ranked.loaded[0]!.path).toBe('index.html')
    expect(ranked.loaded.filter((f) => f.pinned)).toEqual([])
  })

  it('still pins a file when the evidence is found in only a few', async () => {
    const read = async (path: string) =>
      path === 'src/pages/Services.tsx' ? `<link rel="canonical" href="${site}" />` : `// ${path}`

    const ranked = await rankCandidates(tree, finding(), read)

    expect(ranked.loaded[0]).toMatchObject({ path: 'src/pages/Services.tsx', pinned: true })
  })
})

describe('the document shell survives the smallest cut for a rule fixed in the head', () => {
  it('ranks index.html above a helper that only has SEO in its name', () => {
    const tree: TreeEntry[] = [
      file('src/utils/seoHelpers.ts'),
      file('src/data/seoContent.ts'),
      file('index.html'),
      file('src/components/SEO.tsx'),
    ]

    const list = shortlist(tree, finding({ ruleId: 'TECH-023' }))

    expect(list.slice(0, 2).sort()).toEqual(['index.html', 'src/components/SEO.tsx'])
    // A heading is not fixed in the shell, so there it gets no such lift.
    expect(pathScore('index.html', finding({ ruleId: 'TECH-019' }))).toBeLessThan(
      pathScore('index.html', finding({ ruleId: 'TECH-023' })),
    )
  })
})

describe('the share cap protects the best files, it does not exclude them', () => {
  it('keeps the two best files at the smallest size even when one is over the cap', async () => {
    const tree: TreeEntry[] = [
      file('src/components/SEO.tsx'),
      file('index.html'),
      file('src/pages/About.tsx'),
    ]
    const sizes: Record<string, number> = { 'src/components/SEO.tsx': 4_300, 'index.html': 2_800 }
    const read = async (path: string) => 'x'.repeat(sizes[path] ?? 6_000)
    const small = CONTEXT_SIZES[2]!

    const ranked = await rankCandidates(
      tree,
      finding({ ruleId: 'TECH-026', evidence: { ...finding().evidence, snippet: '' } as never }),
      read,
    )
    const context = fitContext(ranked, small)

    expect(4_300).toBeGreaterThan(small.chars * 0.4)
    expect(context.files.map((f) => f.path).sort()).toEqual([
      'index.html',
      'src/components/SEO.tsx',
    ])
  })
})
