import { isAnswered, topicWords, type PageSummary } from '@seo/connectors'
import { parseFinding, type Finding, type TopicMap } from '@seo/core'
import { normaliseUrl, type GraphPage } from '@seo/crawler'

/**
 * The findings the topic map was built to raise (ADR-0024, ADR-0035).
 *
 * The map has been measured and drawn since it shipped and has advised nothing, which is why it
 * added no checks to any axis. These are the two pieces of advice it can honestly give, and both
 * obey the rule ADR-0024 set for them: a model's vectors may say which pages belong together, and
 * whether that is a problem is decided by something a person can check without a model. Here that
 * is the site's own links, and the words in its own titles.
 *
 * Neither reads a cluster's name. The name is a model's label on a group that already exists, and
 * nothing may depend on it.
 */

/** A group smaller than this has nothing to be a hub of. */
export const HUB_MIN_PAGES = 3

/** At most this many of each finding per audit, so a large site does not bury the inbox. */
const MAX_FINDINGS = 5

/** One check each: "does every sizeable group have a hub", and "is every tracked question covered". */
export const HUB_CHECKS = 1
export const QUESTION_COVERAGE_CHECKS = 1

const normal = (url: string): string => normaliseUrl(url) ?? url

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

export interface HubInput {
  siteId: string
  clusters: TopicMap['clusters']
  /** Each crawled page with the internal pages it links to, from `toGraphPages`. */
  graph: readonly GraphPage[]
  /** Internal inbound links and click depth per page, for the evidence. */
  nodes: ReadonlyMap<string, { inboundCount: number; clickDepth: number | null }>
  observedAt: string
}

/**
 * TOPIC-001: several pages on one subject, and no page that links them together.
 *
 * A hub is a page in the group that links to at least half of the others. Which pages form a
 * group comes from the embeddings; whether the group has a hub is counted from the links the
 * crawler found, so anybody can check it by opening the pages.
 *
 * What it does not claim: that a hub will raise rankings. It says the site has a set of related
 * pages a visitor cannot move between from any one of them, which is a fact about the site.
 */
export function evaluateClusterHubs(input: HubInput): Finding[] {
  const outbound = new Map(input.graph.map((page) => [normal(page.url), new Set(page.outbound)]))

  return (
    input.clusters
      .filter((cluster) => cluster.pages.length >= HUB_MIN_PAGES)
      .map((cluster) => {
        const members = cluster.pages.map(normal)
        const needed = Math.ceil((members.length - 1) / 2)

        // For each page, how many of the others in its group it links to.
        const reach = members.map((url) => {
          const links = outbound.get(url) ?? new Set<string>()
          return {
            url,
            linked: members.filter((other) => other !== url && links.has(other)).length,
          }
        })
        // Ties broken by URL, so the page named as "closest to a hub" is the same every run.
        const best = [...reach].sort(
          (a, b) => b.linked - a.linked || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
        )[0]!

        return { members, needed, best }
      })
      .filter(({ best, needed }) => best.linked < needed)
      // Largest groups first: the more pages with no way between them, the more it matters.
      .sort((a, b) => b.members.length - a.members.length || (a.best.url < b.best.url ? -1 : 1))
      .slice(0, MAX_FINDINGS)
      .map(({ members, needed, best }) => {
        const node = input.nodes.get(best.url)
        const others = members.length - 1

        return parseFinding({
          id: `TOPIC-001#${best.url}`,
          siteId: input.siteId,
          ruleId: 'TOPIC-001',
          axis: 'structure',
          severity: 'low',
          // Not 1: which pages belong together rests on an embedding model's vectors.
          confidence: 0.8,
          title:
            `${members.length} pages on one subject have no page linking them together: the ` +
            `best connected, ${pathOf(best.url)}, links to ${best.linked} of the other ${others}`,
          evidence: {
            kind: 'graph',
            source: 'crawler',
            observedAt: input.observedAt,
            url: best.url,
            inboundInternalLinks: node?.inboundCount ?? 0,
            clickDepth: node?.clickDepth ?? null,
          },
          affectedUrls: members,
          estimatedEffort: 'small',
          estimatedImpact: Math.min(40, 10 + members.length * 4),
          falsification:
            `Open each of these ${members.length} pages and count how many of the others it ` +
            `links to. If any one links to at least ${needed} of them, this was wrong. If the ` +
            `pages are not in fact about one subject, this was also wrong: the grouping comes ` +
            `from text similarity and can be mistaken. After a hub is added, the next audit ` +
            `should stop raising this. Expect visitors and crawlers to move between these pages ` +
            `more easily; no ranking change is promised.`,
          fixable: false,
          status: 'open',
        })
      })
  )
}

export interface QuestionCoverageInput {
  siteId: string
  siteUrl: string
  /** The questions this site tracks for AI visibility, in the client's own words. */
  prompts: readonly string[]
  pages: readonly PageSummary[]
  observedAt: string
}

/**
 * TOPIC-002: a question the client tracks, which no page on the site is about.
 *
 * The client chose these questions because they want to be the answer to them. An answer engine
 * retrieves pages and then cites them, so a site with no page on the subject is not in the running,
 * and that is worth saying before a month of polls reports "not cited" for the same reason.
 *
 * Decided by words, not by vectors. The clustering threshold is calibrated for how alike two pages
 * are (ADR-0032), and a one-line question compared with a whole page is a different measurement
 * that nobody has calibrated. So this uses the test CONTENT-002 already uses: do the question's
 * subject words appear in any crawled title or main heading. It is crude, it is checkable by
 * reading, and it errs toward silence, since a page that covers the subject under different
 * words is treated as covering it only if most of the words match.
 */
export function evaluateQuestionCoverage(input: QuestionCoverageInput): Finding[] {
  if (input.pages.length === 0) return []

  const seen = new Set<string>()

  return input.prompts
    .map((prompt) => ({ prompt: prompt.trim(), subject: topicWords(prompt) }))
    .filter(({ prompt, subject }) => {
      // A question with no subject words left after stop words cannot be tested either way.
      if (!prompt || subject.length === 0) return false
      const key = [...subject].sort().join(' ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .filter(({ subject }) => !isAnswered(subject, [...input.pages]))
    .slice(0, MAX_FINDINGS)
    .map(({ prompt, subject }) =>
      parseFinding({
        id: `TOPIC-002#${prompt.toLowerCase()}`,
        siteId: input.siteId,
        ruleId: 'TOPIC-002',
        axis: 'content',
        severity: 'low',
        confidence: 0.8,
        title: `No page on the site is about a question you track: "${prompt}"`,
        evidence: {
          kind: 'markup',
          source: 'crawler',
          observedAt: input.observedAt,
          url: input.siteUrl,
          locator: 'title, h1',
          snippet:
            `Looked for these words in the title and main heading of ${input.pages.length} ` +
            `crawled page(s): ${subject.join(', ')}. No page had most of them.`,
        },
        affectedUrls: [input.siteUrl],
        estimatedEffort: 'medium',
        estimatedImpact: 30,
        falsification:
          `Look for a page whose title or main heading covers most of these words: ` +
          `${subject.join(', ')}. If one exists and was crawled, this was wrong. A page that ` +
          `answers the question in different words is also a reason to dismiss this. After a ` +
          `page on the subject is published, the next audit should stop raising it. Whether ` +
          `the answer engines then cite that page is measured separately, over days, on the AI ` +
          `visibility page, and is not promised here.`,
        fixable: false,
        status: 'open',
      }),
    )
}
