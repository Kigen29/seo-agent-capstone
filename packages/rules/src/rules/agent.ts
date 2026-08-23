import { indexableHtmlPages, markupEvidence, siteEvidence } from '../evidence.js'
import type { Rule, RuleContext } from '../types.js'

const now = (context: RuleContext) => context.pages[0]?.fetchedAt ?? new Date().toISOString()

/**
 * The accessibility half of the agent-readiness axis.
 *
 * These three rules ask what an agent needs before it can act on a page at all: where the content
 * is, what language it is in, and what the images say. They are the same questions a screen reader
 * asks, which is not a coincidence. The accessibility tree is the interface agents were handed,
 * because it is the only machine-readable description of a page's meaning that the web already
 * had, and Lighthouse's own agentic-browsing work is built on it.
 *
 * Every one of them is honest about the same thing: this is not SEO. Google does not rank a page
 * higher for declaring a `main` landmark. They are here because the axis is called agent
 * readiness, and an agent that cannot find the content cannot use the site. Saying otherwise would
 * be the same lie the llms.txt rule refuses to tell (CLAUDE.md rule 8).
 */
const NOT_A_RANKING_FACTOR =
  'Be honest about what this is: an accessibility and agent-readiness improvement, not a ranking ' +
  'factor. Google will not rank the page higher for it. It matters because a screen reader user ' +
  'and an AI agent read the same tree, and both are currently guessing.'

/**
 * AGENT-001: the site has no llms.txt.
 *
 * llms.txt is a root file that lists a site's key pages so an AI agent or crawler can navigate it
 * without guessing. It is agent-readiness infrastructure, and this is the rule that must be most
 * careful about what it claims, because the honest position is a product feature (CLAUDE.md rule 8,
 * and Google's own June 2026 guidance): Google Search ignores llms.txt entirely. So the finding
 * says, in plain language, that adding it helps agents and will not move a Google ranking. A
 * recommendation that implies otherwise is a bug, and a test asserts the disclaimer is present.
 *
 * It is fixable: the agent can generate a well-formed llms.txt from the pages the crawl already
 * found, so the affected URLs carry the site's most-linked pages for the fixer to list.
 */
export const AGENT_001: Rule = {
  id: 'AGENT-001',
  axis: 'agent_readiness',
  severity: 'low',
  estimatedEffort: 'trivial',
  fixable: true,
  description:
    'The site has no llms.txt, the file that helps AI agents navigate it. Not a Google ranking factor.',

  evaluate: (context) => {
    if (context.llmsTxt !== null && context.llmsTxt.trim().length > 0) return []

    // The homepage first, then the most-linked pages, for the fixer to list. Internal inbound
    // links are the site's own vote for what matters, and they come free from the graph.
    const top = [...context.graph.nodes.values()]
      .sort((a, b) => b.inboundCount - a.inboundCount)
      .map((node) => node.url)
    const keyPages = [context.seed, ...top.filter((url) => url !== context.seed)].slice(0, 10)

    return [
      {
        title: `${context.seed} has no llms.txt`,
        evidence: siteEvidence(context.seed, '/llms.txt', '', now(context)),
        affectedUrls: keyPages,
        confidence: 1,
        estimatedImpact: 20,
        falsification:
          'Fetch /llms.txt at the site root. If it returns a non-empty file, this was wrong. Be ' +
          'honest with the user: llms.txt is agent-readiness infrastructure that helps AI agents ' +
          'and crawlers navigate the site, and Google Search ignores it. Expect no Google ranking ' +
          'change from adding it; the benefit is to agents, and that is reason enough.',
      },
    ]
  },
}

/**
 * AGENT-002: a page declares no `main` landmark, or declares several.
 *
 * Without one, nothing on the page says where the content is. An agent has to fall back on
 * heuristics over the markup, and heuristics are how you end up summarising a cookie banner and a
 * navigation menu. Several `main` elements are no better than none: the page has now made the
 * claim twice and an agent still has to choose.
 *
 * The element and the ARIA role count alike, so a site that used `<div role="main">` before `main`
 * was widely supported is not nagged for doing the right thing the older way.
 */
export const AGENT_002: Rule = {
  id: 'AGENT-002',
  axis: 'agent_readiness',
  severity: 'low',
  estimatedEffort: 'trivial',
  // Body structure in whichever component renders the route, which the repo reader cannot locate,
  // and the only file it could write to is a shared layout. Wrapping a layout's children in
  // `<main>` is often right and sometimes very wrong, and an agent cannot tell which.
  fixable: false,
  description: 'A page declares no main landmark, so an agent cannot tell where the content is.',

  evaluate: (context) =>
    indexableHtmlPages(context.pages)
      .filter((page) => page.extract.landmarks.main !== 1)
      .map((page) => {
        const count = page.extract.landmarks.main
        const problem = count === 0 ? 'no main landmark' : `${count} main landmarks`

        return {
          title: `${page.finalUrl} has ${problem}`,
          evidence: markupEvidence(
            page,
            'main, [role="main"]',
            count === 0 ? '' : `${count} elements matched`,
          ),
          affectedUrls: [page.finalUrl],
          confidence: 1,
          estimatedImpact: 20,
          falsification:
            `Re-crawl ${page.finalUrl} and count elements matching main, [role="main"]. If ` +
            'exactly one matches, this was wrong. After the fix, an agent or screen reader can ' +
            'jump straight to the content instead of inferring it. ' +
            NOT_A_RANKING_FACTOR +
            ' Fix this by hand: which region is the main content is a judgement about the page, ' +
            'and wrapping a shared layout blindly would put the navigation inside the content.',
        }
      }),
}

/**
 * AGENT-003: the page does not declare a language.
 *
 * One attribute, and without it nothing on the page says what language the content is in. A
 * screen reader picks a voice from the user's system default and reads French with an English
 * pronunciation model; an agent translating or summarising has to detect the language first and
 * can get it wrong on a short page.
 */
export const AGENT_003: Rule = {
  id: 'AGENT-003',
  axis: 'agent_readiness',
  severity: 'low',
  estimatedEffort: 'trivial',
  // The one place a shared layout is the *right* file: `<html lang>` is genuinely site-wide, so
  // this is fixable in principle. It is not built yet, and the honest state is false rather than
  // a button that fails (ADR-0022).
  fixable: false,
  description: 'The html element declares no lang, so nothing says what language the page is in.',

  evaluate: (context) =>
    indexableHtmlPages(context.pages)
      .filter((page) => page.extract.lang === null)
      .map((page) => ({
        title: `${page.finalUrl} does not declare a language`,
        evidence: markupEvidence(page, 'html[lang]', ''),
        affectedUrls: [page.finalUrl],
        confidence: 1,
        estimatedImpact: 15,
        falsification:
          `Re-fetch ${page.finalUrl} and read the lang attribute on the html element. If it ` +
          'carries one, this was wrong. After the fix, a screen reader picks the right ' +
          'pronunciation and an agent stops having to guess the language. ' +
          NOT_A_RANKING_FACTOR +
          ' Fix this by hand for now: it is one attribute on the html element in your root ' +
          'layout, and the value has to be the language the page is actually written in.',
      })),
}

/**
 * AGENT-004: images carry no alt attribute at all.
 *
 * In the accessibility tree an image with no alt is a hole: a screen reader announces "image" or
 * reads the filename, and an agent parsing the page sees nothing where a picture is. If the image
 * carries meaning, that meaning is simply absent.
 *
 * **A missing alt and an empty alt are not the same thing, and this rule turns on that
 * distinction.** `alt=""` is the correct, deliberate markup for a decorative image: it tells
 * assistive technology to skip it. Flagging that would nag people who did exactly the right thing,
 * which is why the extractor records the two separately and this rule only counts the absent ones.
 */
export const AGENT_004: Rule = {
  id: 'AGENT-004',
  axis: 'agent_readiness',
  severity: 'low',
  estimatedEffort: 'small',
  // Needs alt text written per image, grounded in what the image shows, which nothing in the
  // repository can see. The one thing worse than a missing alt is a confidently wrong one.
  fixable: false,
  description: 'Images have no alt attribute, so they are a hole in the accessibility tree.',

  evaluate: (context) =>
    indexableHtmlPages(context.pages).flatMap((page) => {
      // alt === null is ABSENT. alt === '' is present and deliberately empty, which is correct
      // markup for a decorative image and must never be reported.
      const missing = page.extract.images.filter((image) => image.alt === null)
      if (missing.length === 0) return []

      return [
        {
          title: `${page.finalUrl} has ${missing.length} image(s) with no alt attribute`,
          evidence: markupEvidence(
            page,
            'img:not([alt])',
            missing.map((image) => image.resolved ?? image.src).join('\n'),
          ),
          affectedUrls: [page.finalUrl],
          confidence: 1,
          estimatedImpact: 20,
          falsification:
            `Re-crawl ${page.finalUrl} and count img elements with no alt attribute. If every ` +
            'image has one, this was wrong. Note the distinction this rule depends on: an ' +
            'empty alt="" is correct for a decorative image and is NOT reported here, so do ' +
            'not "fix" those by inventing text for them. ' +
            NOT_A_RANKING_FACTOR +
            ' Fix this by hand: alt text has to describe what the image actually shows, and ' +
            'nothing in the repository can see the picture.',
        },
      ]
    }),
}
