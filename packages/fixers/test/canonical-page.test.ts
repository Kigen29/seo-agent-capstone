import { describe, expect, it } from 'vitest'
import { CanonicalRedirectFixer, pageSources } from '../src/fixers/canonical.js'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { makeFinding } from './fixtures.js'

/**
 * The canonical fixer, when one page writes its own canonical as a literal.
 *
 * The shape of a real repository, after its shared component had been fixed: the root document
 * and `SEO.tsx` both named the serving origin, and `src/pages/BirdWatching.tsx` carried its own
 * `<link rel="canonical">` on the apex, overriding them. The fixer found nothing to change and
 * reported that no fix could be generated.
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
    observedAt: '2026-10-11T00:00:00.000Z',
    source: 'crawler',
  },
})

const PAGE = `import { Helmet } from 'react-helmet-async'

export default function BirdWatching() {
  return (
    <>
      <Helmet>
        <link rel="canonical" href="${APEX}/bird-watching" />
        <meta property="og:url" content="${APEX}/bird-watching" />
      </Helmet>
      <a href="${APEX}/bird-watching/tours">Tours</a>
      <a href="${APEX}/safaris">Safaris</a>
    </>
  )
}
`

/** Both already correct, which is why the earlier steps find nothing. */
const repo: Record<string, string> = {
  'index.html': `<head><meta property="og:url" content="${WWW}/" /></head>`,
  'src/components/SEO.tsx': `// canonical\nconst baseUrl = '${WWW}'\n`,
  'src/pages/BirdWatching.tsx': PAGE,
  'src/pages/Safaris.tsx': `export default () => <link rel="canonical" href="${APEX}/safaris" />\n`,
  'src/pages/admin/Messages.tsx': `export const topic = 'bird-watching'\n`,
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
const generate = (files: Record<string, string>, read = reader(files)) =>
  fixer.generate({ finding, framework: 'react_spa', read, tree: Object.keys(files) })

describe('CanonicalRedirectFixer, with the canonical written in the page', () => {
  it('finds the page by its name and moves its canonical to the serving origin', async () => {
    const result = await generate(repo)

    expect(result).not.toBeNull()
    expect(result!.files.map((file) => file.path)).toEqual(['src/pages/BirdWatching.tsx'])
    expect(result!.files[0]!.content).toContain(
      `<link rel="canonical" href="${WWW}/bird-watching" />`,
    )
    expect(result!.files[0]!.content).toContain(`content="${WWW}/bird-watching"`)
  })

  it('rewrites that address only, and leaves every other link in the page alone', async () => {
    const content = (await generate(repo))!.files[0]!.content

    // A longer address under the same path is a different page.
    expect(content).toContain(`href="${APEX}/bird-watching/tours"`)
    expect(content).toContain(`href="${APEX}/safaris"`)

    const before = PAGE.split('\n')
    const after = content.split('\n')
    expect(after).toHaveLength(before.length)
    expect(before.filter((line, index) => line !== after[index])).toHaveLength(2)
  })

  it('opens only files named after the page', async () => {
    const read = reader(repo)
    await generate(repo, read)

    expect(read.opened).toContain('src/pages/BirdWatching.tsx')
    expect(read.opened).not.toContain('src/pages/Safaris.tsx')
    expect(read.opened).not.toContain('src/pages/admin/Messages.tsx')
  })

  it('keeps a trailing slash as the page wrote it', async () => {
    const result = await generate({
      'src/pages/BirdWatching.tsx': `<link rel="canonical" href="${APEX}/bird-watching/" />\n`,
    })

    expect(result!.files[0]!.content).toBe(
      `<link rel="canonical" href="${WWW}/bird-watching/" />\n`,
    )
  })

  it('declines a page that names the address and never mentions a canonical', async () => {
    const result = await generate({
      'src/pages/BirdWatching.tsx': `export default () => <a href="${APEX}/bird-watching">Here</a>\n`,
    })

    expect(result).toBeNull()
  })

  it('declines a page of that name that does not contain the address', async () => {
    const result = await generate({
      'src/pages/BirdWatching.tsx': `// canonical comes from the layout\nexport default () => null\n`,
    })

    expect(result).toBeNull()
  })

  it('is not reached when the shared component still has the old origin', async () => {
    const read = reader({
      ...repo,
      'src/components/SEO.tsx': `// canonical\nconst b = '${APEX}'\n`,
    })
    const result = await fixer.generate({
      finding,
      framework: 'react_spa',
      read,
      tree: Object.keys(repo),
    })

    expect(result!.files.map((file) => file.path)).toEqual(['src/components/SEO.tsx'])
    expect(read.opened).not.toContain('src/pages/BirdWatching.tsx')
  })
})

describe('pageSources', () => {
  const url = `${APEX}/bird-watching`

  it('matches a file or a directory named after the last path segment, however it is cased', () => {
    expect(
      pageSources(
        [
          'src/pages/BirdWatching.tsx',
          'app/bird-watching/page.tsx',
          'src/pages/bird_watching/index.astro',
          'src/pages/Birds.tsx',
          'src/pages/BirdWatchingTours.tsx',
          'app/bird-watching/layout.tsx',
        ],
        url,
      ),
    ).toEqual([
      'app/bird-watching/page.tsx',
      'src/pages/BirdWatching.tsx',
      'src/pages/bird_watching/index.astro',
    ])
  })

  it('offers nothing for the home page or a segment too short to name a file', () => {
    expect(pageSources(['src/pages/Index.tsx', 'src/pages/Go.tsx'], `${APEX}/`)).toEqual([])
    expect(pageSources(['src/pages/Go.tsx'], `${APEX}/go`)).toEqual([])
  })

  it('never offers tests, build output or files that are not source', () => {
    expect(
      pageSources(
        [
          'dist/bird-watching.html',
          'src/pages/BirdWatching.test.tsx',
          'e2e/bird-watching.ts',
          'docs/bird-watching.md',
        ],
        url,
      ),
    ).toEqual([])
  })

  it('opens a bounded number of files', () => {
    const many = Array.from({ length: 40 }, (_, i) => `src/v${i}/bird-watching/index.tsx`)

    expect(pageSources(many, url).length).toBeLessThanOrEqual(6)
  })
})
