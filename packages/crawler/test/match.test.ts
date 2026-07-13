import { describe, expect, it } from 'vitest'
import { crawlDelayFor, isAllowed } from '../src/robots/match.js'
import { ALLOW_ALL, parseRobotsTxt } from '../src/robots/parse.js'
import { loadRobots } from './fixtures.js'

describe('isAllowed: precedence', () => {
  const robots = loadRobots('precedence')

  it.each([
    ['/', true],
    ['/admin', false],
    ['/admin/users', false],
    ['/blog/', false],
    ['/blog/post-1', false],
    // Longer pattern wins, so the Allow beats the parent Disallow.
    ['/blog/public/', true],
    ['/blog/public/post-1', true],
  ])('%s -> allowed=%s', (path, expected) => {
    expect(isAllowed(robots, 'SomeBot', path)).toBe(expected)
  })

  it('honours $ as an end-of-URL anchor', () => {
    expect(isAllowed(robots, 'SomeBot', '/downloads/report.pdf')).toBe(false)
    // Does not end in .pdf, so the disallow pattern does not apply.
    expect(isAllowed(robots, 'SomeBot', '/downloads/report.pdf.html')).toBe(true)
  })

  it('lets a longer allow override a wildcard disallow', () => {
    expect(isAllowed(robots, 'SomeBot', '/downloads/brochure.pdf')).toBe(true)
  })

  it('matches against the query string, not just the path', () => {
    expect(isAllowed(robots, 'SomeBot', '/search?q=shoes')).toBe(false)
    expect(isAllowed(robots, 'SomeBot', '/search')).toBe(true)
  })

  it('gives the tie to the least restrictive rule, so allow beats disallow', () => {
    const tie = parseRobotsTxt('User-agent: *\nDisallow: /x\nAllow: /x')

    expect(isAllowed(tie, 'AnyBot', '/x')).toBe(true)
  })
})

describe('isAllowed: group selection', () => {
  const robots = loadRobots('precedence')

  it('uses the most specific matching user agent, not the catch-all', () => {
    // Googlebot has its own group, which allows everything except /private/.
    expect(isAllowed(robots, 'Googlebot', '/admin')).toBe(true)
    expect(isAllowed(robots, 'Googlebot', '/private/x')).toBe(false)

    // An agent with no group of its own falls back to *, where /admin is blocked.
    expect(isAllowed(robots, 'SomeBot', '/admin')).toBe(false)
  })

  it('ignores version suffixes, so Googlebot/2.1 is Googlebot', () => {
    expect(isAllowed(robots, 'Googlebot/2.1', '/admin')).toBe(true)
  })

  it('matches user agents case-insensitively', () => {
    expect(isAllowed(robots, 'GOOGLEBOT', '/admin')).toBe(true)
  })
})

describe('isAllowed: permissive defaults', () => {
  it('allows everything when robots.txt is absent', () => {
    expect(isAllowed(ALLOW_ALL, 'OAI-SearchBot', '/anything')).toBe(true)
  })

  it('allows everything when the file is empty', () => {
    expect(isAllowed(parseRobotsTxt(''), 'OAI-SearchBot', '/')).toBe(true)
  })

  it('allows everything when no group matches and there is no catch-all', () => {
    const robots = parseRobotsTxt('User-agent: Googlebot\nDisallow: /')

    expect(isAllowed(robots, 'OAI-SearchBot', '/')).toBe(true)
  })

  it('treats an empty Disallow as no restriction at all', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow:')

    expect(isAllowed(robots, 'AnyBot', '/anything')).toBe(true)
  })
})

describe('crawlDelayFor', () => {
  it('reports the delay the site asked for, which we honour', () => {
    expect(crawlDelayFor(loadRobots('precedence'), 'SomeBot')).toBe(2)
  })

  it('is undefined when the site did not ask for one', () => {
    expect(crawlDelayFor(loadRobots('precedence'), 'Googlebot')).toBeUndefined()
  })
})
