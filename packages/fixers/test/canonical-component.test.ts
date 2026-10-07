import { describe, expect, it } from 'vitest'
import { CanonicalRedirectFixer, headComponents } from '../src/fixers/canonical.js'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { makeFinding } from './fixtures.js'

/**
 * The canonical fixer, when the tag is built in a component and not written in the root document.
 *
 * Every case here is the shape of a real repository, where this fixer reported that no fix could
 * be generated: `index.html` already named the serving origin, and `src/components/SEO.tsx`
 * joined a hard-coded apex origin to the current path. Eight findings, three attempts each, all
 * failed, on a change that is one string.
 */

const APEX = 'https://heartbeestsafaris.com'
const WWW = 'https://www.heartbeestsafaris.com'

const finding = makeFinding({
  ruleId: 'TECH-007',
  title: `${WWW}/bird-watching declares the canonical ${APEX}/bird-watching, which redirects to ${WWW}/bird-watching`,
  affectedUrls: [`${WWW}/bird-watching`, `${APEX}/bird-watching`],
  evidence: {
    kind: 'http',
    url: `${WWW}/bird-watching`,
    status: 200,
    redirectChain: [`${APEX}/bird-watching`],
    observedAt: '2026-10-07T00:00:00.000Z',
    source: 'crawler',
  },
})

/** Already correct: the reason the fixer used to find nothing to do. */
const INDEX_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:url" content="${WWW}/" />
  </head>
  <body><div id="root"></div></body>
</html>
`

const SEO_TSX = `import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'

export function SEO({ image }: { image: string }) {
  const { pathname } = useLocation()
  const generateCanonicalUrl = () => {
    const baseUrl = '${APEX}';
    const cleanPath = pathname.replace(/\\/$/, '')
    return \`\${baseUrl}\${cleanPath}\`;
  }
  const canonical = generateCanonicalUrl()
  const fullImage = \`${APEX}\${image}\`

  return (
    <Helmet>
      <link rel="canonical" href={canonical} />
      <meta property="og:url" content={canonical} />
      <meta name="twitter:site" content="@heartbeestsafaris" />
    </Helmet>
  )
}
`

/** Mentions the origin and is nothing to do with the canonical. It must not be touched. */
const FOOTER_TSX = `export const Footer = () => <a href="${APEX}/contact">Contact</a>\n`

const repo: Record<string, string> = {
  'index.html': INDEX_HTML,
  'src/components/SEO.tsx': SEO_TSX,
  'src/components/Footer.tsx': FOOTER_TSX,
  'src/pages/BirdWatching.tsx': `export default () => <a href="${APEX}/safaris">Safaris</a>\n`,
  'k6/lib/config.js': `export const BASE = '${APEX}'\n`,
}

function reader(files: Record<string, string>): ReadRepoFile & { opened: string[] } {
  const opened: string[] = []
  const read = (async (path: string) => {
    opened.push(path)
    return path in files ? files[path]! : null
  }) as ReadRepoFile & { opened: string[] }
  read.opened = opened
  return read
}

const fixer = new CanonicalRedirectFixer()

describe('CanonicalRedirectFixer, with the tag built in a component', () => {
  it('finds the component and rewrites the origin there', async () => {
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read: reader(repo),
      tree: Object.keys(repo),
    })

    expect(result).not.toBeNull()
    expect(result!.files.map((file) => file.path)).toEqual(['src/components/SEO.tsx'])

    const content = result!.files[0]!.content
    expect(content).toContain(`const baseUrl = '${WWW}';`)
    expect(content).toContain(`\`${WWW}\${image}\``)
    expect(content).not.toContain(`'${APEX}'`)
  })

  it('changes nothing but the origin, so the diff is two lines', async () => {
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read: reader(repo),
      tree: Object.keys(repo),
    })

    const before = SEO_TSX.split('\n')
    const after = result!.files[0]!.content.split('\n')
    const changed = before.filter((line, index) => line !== after[index])

    expect(after).toHaveLength(before.length)
    expect(changed).toHaveLength(2)
    // A handle that merely contains the brand is not an origin and is left alone.
    expect(result!.files[0]!.content).toContain('@heartbeestsafaris')
  })

  it('leaves alone a file that names the origin for another reason', async () => {
    const read = reader(repo)
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read,
      tree: Object.keys(repo),
    })

    expect(result!.files.some((file) => file.path.includes('Footer'))).toBe(false)
    // Not merely unchanged: a page, a footer and a load-test config are never opened at all.
    expect(read.opened).not.toContain('src/components/Footer.tsx')
    expect(read.opened).not.toContain('src/pages/BirdWatching.tsx')
    expect(read.opened).not.toContain('k6/lib/config.js')
  })

  it('does not rewrite a head component that never mentions a canonical', async () => {
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read: reader({
        'index.html': INDEX_HTML,
        'src/components/Head.tsx': `export const Head = () => <link rel="icon" href="${APEX}/icon.png" />\n`,
      }),
      tree: ['index.html', 'src/components/Head.tsx'],
    })

    expect(result).toBeNull()
  })

  it('prefers the root document when the origin is there, and opens no component', async () => {
    const read = reader({
      ...repo,
      'index.html': `<head><link rel="canonical" href="${APEX}/" /></head>`,
    })
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read,
      tree: Object.keys(repo),
    })

    expect(result!.files.map((file) => file.path)).toEqual(['index.html'])
    expect(read.opened).not.toContain('src/components/SEO.tsx')
  })

  it('behaves exactly as before when no tree is given', async () => {
    const result = await fixer.generate({ finding, framework: 'react_spa', read: reader(repo) })

    expect(result).toBeNull()
  })

  it('never rewrites a look-alike host that merely starts with the origin', async () => {
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read: reader({
        'index.html': INDEX_HTML,
        'src/components/SEO.tsx': `// canonical\nconst a = '${APEX}'\nconst b = '${APEX}.evil.test'\n`,
      }),
      tree: ['index.html', 'src/components/SEO.tsx'],
    })

    expect(result!.files[0]!.content).toContain(`const a = '${WWW}'`)
    expect(result!.files[0]!.content).toContain(`const b = '${APEX}.evil.test'`)
  })
})

describe('headComponents', () => {
  it('keeps source files whose name is about the head, most specific first', () => {
    expect(
      headComponents([
        'src/layouts/Layout.astro',
        'src/components/SEO.tsx',
        'src/components/Head.tsx',
        'src/utils/seoHelpers.ts',
        'src/components/Footer.tsx',
        'README.md',
      ]),
    ).toEqual([
      'src/components/SEO.tsx',
      'src/utils/seoHelpers.ts',
      'src/components/Head.tsx',
      'src/layouts/Layout.astro',
    ])
  })

  it('reads a word by its edges, so a header or a museum is not a head or an seo', () => {
    expect(
      headComponents([
        'src/components/Header.tsx',
        'src/pages/museum.ts',
        'src/components/PageHead.tsx',
        'src/lib/siteMetadata.ts',
      ]),
    ).toEqual(['src/components/PageHead.tsx', 'src/lib/siteMetadata.ts'])
  })

  it('never offers dependencies, build output, tests or load tests', () => {
    expect(
      headComponents([
        'node_modules/react-helmet/lib/Helmet.js',
        'dist/assets/seo.js',
        'src/components/SEO.test.tsx',
        'src/components/__tests__/seo.tsx',
        'k6/lib/seo.js',
        'e2e/seo.spec.ts',
      ]),
    ).toEqual([])
  })

  it('opens a bounded number of files however large the repository', () => {
    const many = Array.from({ length: 200 }, (_, i) => `src/seo/part${i}.ts`)

    expect(headComponents(many).length).toBeLessThanOrEqual(12)
  })
})
