import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { googleVerificationTag, injectHeadTags, renderTag } from '../src/head/inject.js'

const reader =
  (files: Record<string, string>): ReadRepoFile =>
  async (path: string) =>
    path in files ? files[path]! : null

describe('renderTag', () => {
  it('renders a meta tag', () => {
    expect(renderTag({ tag: 'meta', attributes: { name: 'x', content: 'y' } })).toBe(
      '<meta name="x" content="y" />',
    )
  })

  it('renders a link tag', () => {
    expect(renderTag({ tag: 'link', attributes: { rel: 'canonical', href: 'https://x/' } })).toBe(
      '<link rel="canonical" href="https://x/" />',
    )
  })

  it('escapes quotes in attribute values', () => {
    expect(renderTag({ tag: 'meta', attributes: { content: 'a"b' } })).toContain('a&quot;b')
  })

  it('builds the Google verification tag', () => {
    expect(renderTag(googleVerificationTag('TOKEN'))).toBe(
      '<meta name="google-site-verification" content="TOKEN" />',
    )
  })
})

describe('injectHeadTags', () => {
  const tag = googleVerificationTag('abc')

  it('injects into a SPA index.html before </head>, aligned with the head children', async () => {
    // The exact shape of the connected demo repo: a Vite React SPA with a root index.html.
    const read = reader({
      'index.html':
        '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n',
    })

    const change = await injectHeadTags('react_spa', read, [tag])

    expect(change?.path).toBe('index.html')
    expect(change?.content).toContain('    <meta name="google-site-verification" content="abc" />')
    // Inserted before the closing head tag.
    expect(change!.content.indexOf('google-site-verification')).toBeLessThan(
      change!.content.indexOf('</head>'),
    )
  })

  it('is idempotent: returns null when the tag is already present', async () => {
    const read = reader({
      'index.html': '<head>\n<meta name="google-site-verification" content="abc" />\n</head>',
    })
    expect(await injectHeadTags('react_spa', read, [tag])).toBeNull()
  })

  it('inserts only the missing tags, never duplicating one already there', async () => {
    const read = reader({
      'index.html': '<head>\n  <meta name="google-site-verification" content="abc" />\n  </head>',
    })
    const change = await injectHeadTags('react_spa', read, [
      tag,
      { tag: 'link', attributes: { rel: 'canonical', href: 'https://x/' } },
    ])

    expect(change?.content).toContain('rel="canonical"')
    expect(change!.content.match(/google-site-verification/g)).toHaveLength(1)
  })

  it('returns null when no candidate file has a head, rather than invent one', async () => {
    expect(await injectHeadTags('react_spa', reader({ 'README.md': '# hi' }), [tag])).toBeNull()
  })

  it('uses the framework-head file for Next when it has a literal head', async () => {
    const read = reader({
      'app/layout.tsx':
        'export default function L() {\n  return (\n    <html>\n      <head></head>\n      <body />\n    </html>\n  )\n}\n',
    })
    const change = await injectHeadTags('next', read, [tag])
    expect(change?.path).toBe('app/layout.tsx')
    expect(change?.content).toContain('google-site-verification')
  })

  it('matches the closing head tag case-insensitively', async () => {
    const change = await injectHeadTags('react_spa', reader({ 'index.html': '<HEAD></HEAD>' }), [
      tag,
    ])
    expect(change?.content).toContain('google-site-verification')
  })

  it('does nothing for an empty tag list', async () => {
    expect(
      await injectHeadTags('react_spa', reader({ 'index.html': '<head></head>' }), []),
    ).toBeNull()
  })
})
