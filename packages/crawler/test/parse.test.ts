import { describe, expect, it } from 'vitest'
import { isAllowed } from '../src/robots/match.js'
import { parseRobotsTxt } from '../src/robots/parse.js'
import { loadRobots } from './fixtures.js'

describe('parseRobotsTxt', () => {
  it('groups consecutive user-agent lines together', () => {
    const robots = parseRobotsTxt(`
      User-agent: GPTBot
      User-agent: CCBot
      Disallow: /
    `)

    expect(robots.groups).toHaveLength(1)
    expect(robots.groups[0]?.userAgents).toEqual(['gptbot', 'ccbot'])
  })

  it('starts a new group when a user-agent line follows a rule', () => {
    // The classic parser bug is merging these two into one group.
    const robots = parseRobotsTxt(`
      User-agent: GPTBot
      Disallow: /
      User-agent: *
      Allow: /
    `)

    expect(robots.groups).toHaveLength(2)
    expect(robots.groups[0]?.userAgents).toEqual(['gptbot'])
    expect(robots.groups[1]?.userAgents).toEqual(['*'])
  })

  it('collects sitemaps independently of any group', () => {
    const robots = loadRobots('cloudflare-content-signals')

    expect(robots.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/news-sitemap.xml',
    ])
  })

  it('parses Cloudflare Content-Signals', () => {
    const robots = loadRobots('cloudflare-content-signals')

    expect(robots.groups[0]?.contentSignals).toEqual({
      search: 'yes',
      'ai-input': 'yes',
      'ai-train': 'no',
    })
  })

  it('parses crawl-delay', () => {
    expect(loadRobots('precedence').groups[0]?.crawlDelay).toBe(2)
  })

  it('survives a messy file rather than throwing', () => {
    // A parse error must never be reported as "this site blocks AI crawlers".
    const robots = loadRobots('messy')

    expect(robots.absent).toBe(false)
    expect(robots.groups[0]?.userAgents).toEqual(['*'])
  })

  it('discards the junk in a messy file without discarding the real rules', () => {
    const robots = loadRobots('messy')

    // The colonless line, `Host:`, and `Request-rate:` are all dropped. The empty
    // `Disallow:` survives as a rule that restricts nothing, and the `Allow: /` is kept
    // despite its leading whitespace and padded value.
    expect(robots.groups[0]?.rules).toEqual([
      { type: 'disallow', pattern: '' },
      { type: 'allow', pattern: '/' },
    ])
    expect(robots.sitemaps).toEqual([])
    expect(robots.groups[0]?.contentSignals).toBeUndefined()
  })

  it('does not attribute an orphaned rule to the previous group', () => {
    // The fixture ends with a valueless `User-agent:` followed by a Disallow. If that
    // rule leaked into the `*` group above it, we would be inventing a disallow the
    // site never wrote for a crawler it never named.
    const robots = loadRobots('messy')

    expect(robots.groups).toHaveLength(2)
    expect(robots.groups[1]?.userAgents).toEqual([]) // names nobody, so matches nobody
    expect(robots.groups[0]?.rules).not.toContainEqual({
      type: 'disallow',
      pattern: '/orphaned-value-with-no-agent',
    })
  })

  it('leaves an orphaned rule inert, so no crawler is affected by it', () => {
    const robots = loadRobots('messy')

    expect(isAllowed(robots, 'AnyBot', '/orphaned-value-with-no-agent')).toBe(true)
    expect(isAllowed(robots, 'OAI-SearchBot', '/orphaned-value-with-no-agent')).toBe(true)
  })

  it('ignores an empty Disallow, which restricts nothing', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow:')

    expect(robots.groups[0]?.rules).toEqual([{ type: 'disallow', pattern: '' }])
  })

  it('marks a file it never saw as absent, and absent means allow everything', () => {
    expect(parseRobotsTxt('').absent).toBe(false)
  })
})
