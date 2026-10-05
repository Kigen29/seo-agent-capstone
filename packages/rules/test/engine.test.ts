import { describe, expect, it } from 'vitest'
import { runRules } from '../src/engine.js'
import { ALL_RULES } from '../src/registry.js'
import { context, html, page, u } from './context.js'

/**
 * Enough real, distinct prose that neither page is thin and the two are not near-duplicates. The
 * clean fixture used to be two sentences a page, which a thin-content rule rightly objects to: a
 * fixture that only passes because nothing checks it is not a clean site.
 */
const HOME_COPY =
  'We are a small family company that has organised walking tours of the old town since 1998. ' +
  'Every guide was born here, speaks at least two languages, and carries a first aid certificate. ' +
  'Groups are never larger than twelve people, so everyone can hear and nobody is left behind at ' +
  'a crossing. Tours leave from the fountain in the main square at nine in the morning and at two ' +
  'in the afternoon, every day except Monday, and run whatever the weather is doing. Booking ahead ' +
  'is free, and you only pay on the day once you have met your guide and decided to come along.'

const TOUR_COPY =
  'The standard route takes about two and a half hours at an easy pace and covers three kilometres ' +
  'of mostly flat cobbled streets. It begins at the cathedral steps, passes the covered market and ' +
  'the river gate, and finishes at the castle terrace where there is a cafe and a public toilet. ' +
  'Adults pay eighteen euros, children under twelve pay nine, and infants in carriers come free. ' +
  'Wear closed shoes, bring water in summer, and tell us in advance about wheelchairs or prams so ' +
  'that we can swap the one stepped alley for the ramp beside the old customs house instead.'

describe('the rule registry', () => {
  it('ships the forty-three rules the registry declares', () => {
    expect(ALL_RULES).toHaveLength(43)
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
      expect(finding.id).toMatch(/^[A-Z]+-\d{3}#\d+$/)
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
            `<h1>Home</h1><h2>About</h2><p>Real words on a real page, enough of them to be a page. ${HOME_COPY}</p><a href="/a">Guided walking tours</a>`,
            `<title>Home</title><meta name="description" content="A clean homepage with a real description."><link rel="canonical" href="${u('/')}">`,
          ),
        }),
        page({
          path: '/a',
          html: html.doc(
            `<h1>Page A</h1><p>Different words entirely, on a different page. ${TOUR_COPY}</p>`,
            `<title>Page A</title><meta name="description" content="What a guided walking tour covers and what it costs."><link rel="canonical" href="${u('/a')}">`,
          ),
        }),
      ],
      robotsTxt: `User-agent: *\nAllow: /\nSitemap: ${u('/sitemap.xml')}`,
      sitemapUrls: [u('/'), u('/a')],
      llmsTxt: `# Clean site\n\n> A clean site.\n\n## Pages\n\n- [Home](${u('/')})`,
    })

    expect(runRules(clean)).toEqual([])
  })
})
