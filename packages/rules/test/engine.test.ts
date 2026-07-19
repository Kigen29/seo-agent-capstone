import { describe, expect, it } from 'vitest'
import { runRules } from '../src/engine.js'
import { ALL_RULES } from '../src/registry.js'
import { context, html, page, u } from './context.js'

describe('the rule registry', () => {
  it('ships the twenty-one TECH rules the sprint asked for', () => {
    expect(ALL_RULES).toHaveLength(21)
  })

  it('has no duplicate rule ids', () => {
    const ids = ALL_RULES.map((rule) => rule.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every rule a falsification-bearing description and an axis', () => {
    for (const rule of ALL_RULES) {
      expect(rule.description.length).toBeGreaterThan(10)
      expect(rule.axis).toBeTruthy()
    }
  })
})

describe('runRules', () => {
  const broken = context({
    pages: [
      page({ path: '/', html: html.linkingTo('/gone', '/a') }),
      page({ path: '/a', html: html.h1s(2) }),
      page({ path: '/gone', status: 404 }),
    ],
    robotsTxt: 'User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /',
    sitemapUrls: [u('/')],
  })

  it('produces findings that satisfy the Finding schema, falsification included', () => {
    // The schema is what enforces rule 3. If a rule ever returns an empty falsification,
    // parseFinding throws and this test fails, which is exactly the intent.
    const findings = runRules(broken)

    expect(findings.length).toBeGreaterThan(0)

    for (const finding of findings) {
      expect(finding.falsification.length).toBeGreaterThan(0)
      expect(finding.evidence).toBeTruthy()
      expect(finding.id).toMatch(/^TECH-\d{3}#\d+$/)
      expect(finding.siteId).toBe('site_1')
      expect(finding.status).toBe('open')
    }
  })

  it('sorts the backlog by priority, so the critical AI block leads', () => {
    const findings = runRules(broken)

    expect(findings[0]?.ruleId).toBe('TECH-002')
    expect(findings[0]?.severity).toBe('critical')
  })

  it('is deterministic: the same crawl yields the same findings in the same order', () => {
    // Without this, a regression in the rule engine is undetectable, because you can
    // never tell a real change from run-to-run noise.
    const first = runRules(broken).map((f) => f.id)
    const second = runRules(broken).map((f) => f.id)

    expect(first).toEqual(second)
  })

  it('gives a finding a stable id across runs, so the verifier can re-check it', () => {
    expect(runRules(broken).map((f) => f.id)).toContain('TECH-002#0')
  })

  it('finds nothing on a clean site', () => {
    // The most important test in the file. An audit tool that always finds something is
    // an audit tool nobody trusts.
    const clean = context({
      pages: [
        page({
          path: '/',
          html: html.doc(
            '<h1>Home</h1><h2>About</h2><p>Real words on a real page, enough of them to be a page.</p><a href="/a">A</a>',
            `<title>Home</title><meta name="description" content="A clean homepage with a real description."><link rel="canonical" href="${u('/')}">`,
          ),
        }),
        page({
          path: '/a',
          html: html.doc(
            '<h1>Page A</h1><p>Different words entirely, on a different page.</p>',
            `<title>Page A</title><link rel="canonical" href="${u('/a')}">`,
          ),
        }),
      ],
      robotsTxt: `User-agent: *\nAllow: /\nSitemap: ${u('/sitemap.xml')}`,
      sitemapUrls: [u('/'), u('/a')],
    })

    expect(runRules(clean)).toEqual([])
  })
})
