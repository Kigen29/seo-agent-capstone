import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { injectHeadHtml, injectHeadTags, renderTag } from '../src/head/inject.js'

const reader =
  (files: Record<string, string>): ReadRepoFile =>
  async (path: string) =>
    path in files ? files[path]! : null

const SPA_INDEX =
  '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n'

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

  it('escapes quotes in the values we render ourselves', () => {
    expect(renderTag({ tag: 'meta', attributes: { content: 'a"b' } })).toContain('a&quot;b')
  })
})

describe('injectHeadHtml', () => {
  // The verification token from Google is a whole <meta> tag; it must be inserted unchanged.
  const token = '<meta name="google-site-verification" content="37PYOdaE9rgB1p7yc77" />'

  it('inserts a raw snippet verbatim, not escaped or wrapped', async () => {
    const change = await injectHeadHtml('react_spa', reader({ 'index.html': SPA_INDEX }), [token])

    expect(change?.path).toBe('index.html')
    // The exact token string is present, byte for byte. No &lt;, no nested tag.
    expect(change?.content).toContain(token)
    expect(change?.content).not.toContain('&lt;')
    expect(change?.content).not.toContain('content="&lt;meta')
  })

  it('is idempotent when the raw snippet is already there', async () => {
    const read = reader({ 'index.html': `<head>\n  ${token}\n  </head>` })
    expect(await injectHeadHtml('react_spa', read, [token])).toBeNull()
  })

  it('returns null when no candidate file has a head', async () => {
    expect(await injectHeadHtml('react_spa', reader({ 'README.md': '# hi' }), [token])).toBeNull()
  })

  it('does nothing for an empty snippet list', async () => {
    expect(await injectHeadHtml('react_spa', reader({ 'index.html': SPA_INDEX }), [])).toBeNull()
  })
})

describe('injectHeadTags', () => {
  const tag = { tag: 'link' as const, attributes: { rel: 'canonical', href: 'https://x/' } }

  it('injects a structured tag before </head>, aligned with the head children', async () => {
    const change = await injectHeadTags('react_spa', reader({ 'index.html': SPA_INDEX }), [tag])

    expect(change?.path).toBe('index.html')
    expect(change?.content).toContain('    <link rel="canonical" href="https://x/" />')
    expect(change!.content.indexOf('canonical')).toBeLessThan(change!.content.indexOf('</head>'))
  })

  it('uses the framework-head file for Next when it has a literal head', async () => {
    const read = reader({
      'app/layout.tsx':
        'export default function L() {\n  return (\n    <html>\n      <head></head>\n      <body />\n    </html>\n  )\n}\n',
    })
    const change = await injectHeadTags('next', read, [tag])
    expect(change?.path).toBe('app/layout.tsx')
    expect(change?.content).toContain('rel="canonical"')
  })

  it('matches the closing head tag case-insensitively', async () => {
    const change = await injectHeadTags('react_spa', reader({ 'index.html': '<HEAD></HEAD>' }), [
      tag,
    ])
    expect(change?.content).toContain('rel="canonical"')
  })
})
