import { buildScorecard, priorityScore, type Finding } from '@seo/core'
import {
  apiTokens,
  asOwner,
  audits,
  findings,
  fixAttempts,
  sites,
  schema,
  spend,
  tenants,
  visibilityChecks,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import { canFixFinding } from '@seo/fixers'
import { ruleCoverage } from '@seo/rules'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { CompetitorSnapshot } from './competitors/snapshot.js'
import { watchCompetitors } from './competitors/watch.js'
import { fingerprintAll } from './fingerprint.js'
import { baselineFor, verificationFor } from './outcome-evidence.js'
import { evaluateClusterHubs, evaluateQuestionCoverage } from './topic-findings.js'

/**
 * A second seeded tenant, with every populated state the screens can show.
 *
 * The e2e tenant in `seed.ts` is deliberately sparse: one audit, two open findings, nothing
 * connected. That is the right fixture for assertions and the wrong one for looking, because most
 * of the interface only exists once there is history. Outcome cards, share of voice, the authority
 * lists, the spend bar and the "since the audit before" column all rendered as empty states, so a
 * layout change to any of them could not be seen before it shipped.
 *
 * A separate tenant rather than more rows on the first, so no existing assertion moves: the e2e
 * suite counts that tenant's rows, and row-level security means it cannot see these.
 *
 * The same rule as `seed.ts` applies, and matters more here because there is more to get wrong:
 * nothing is hand-drawn that a real code path can produce. Titles, evidence and falsification
 * text are the rules' own; `fixable` comes from `canFixFinding`; fingerprints from
 * `fingerprintAll`; baselines and verification records from the functions the worker calls; the
 * scorecards from `buildScorecard`. Every domain is under `example.com`, `.org` or `.net`, which
 * are reserved, so no real publication is named as having written about anyone.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

export const SHOWCASE = {
  tenant: 'showcase-tenant',
  token: 'seo_e2e_showcase_token_do_not_use_in_production',
  tenantId: uuid(1),
  siteId: uuid(3),
  earlierAuditId: uuid(4),
  latestAuditId: uuid(5),
  siteUrl: 'https://showcase.example.com',
  competitors: ['rival-one.example.com', 'rival-two.example.com'],
  brand: 'Showcase',
} as const

const URL = SHOWCASE.siteUrl
const REPO = 'https://github.com/example/showcase'

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex')
const daysAgo = (days: number, from: Date) => new Date(from.getTime() - days * 86_400_000)

const NOINDEX_FALSIFICATION = (page: string) =>
  `Re-fetch ${page} and check both the robots meta tag and the X-Robots-Tag ` +
  'header. If neither says noindex, this was wrong. After the fix, Search Console ' +
  'URL Inspection should report the page as indexable, and it should appear in the ' +
  'index within a few weeks. If it stays out, the cause was not the noindex.'

/** TECH-005, as `packages/rules/src/rules/indexation.ts` writes it, for one page. */
const noindexed = (
  path: string,
  observedAt: string,
): Omit<Finding, 'id' | 'fixable' | 'status'> => ({
  siteId: SHOWCASE.siteId,
  ruleId: 'TECH-005',
  axis: 'crawl_health',
  severity: 'high',
  confidence: 0.95,
  title: `${URL}${path} is noindexed but is in the sitemap`,
  evidence: {
    kind: 'markup',
    observedAt,
    source: 'crawler',
    url: `${URL}${path}`,
    locator: 'meta[name="robots"]',
    snippet: 'noindex, follow',
  },
  affectedUrls: [`${URL}${path}`],
  estimatedEffort: 'trivial',
  estimatedImpact: 75,
  falsification: NOINDEX_FALSIFICATION(`${URL}${path}`),
})

/** The findings one audit raised, before `fixable` is derived. Statuses are set by the caller. */
function templates(observedAt: string) {
  const blocked: Omit<Finding, 'id' | 'fixable' | 'status'> = {
    siteId: SHOWCASE.siteId,
    ruleId: 'TECH-002',
    axis: 'ai_visibility',
    severity: 'critical',
    confidence: 1,
    title: 'robots.txt blocks OAI-SearchBot, removing this site from AI answers',
    evidence: {
      kind: 'markup',
      observedAt,
      source: 'crawler',
      url: `${URL}/robots.txt`,
      locator: '/robots.txt',
      // The line TECH-002 records and `UnblockAiCrawlersFixer` parses. See `seed.ts`.
      snippet:
        'Disallowed: OAI-SearchBot (OpenAI). CRITICAL: you cannot be cited in ChatGPT search ' +
        'results. You have removed yourself from the answer.',
    },
    affectedUrls: [`${URL}/`],
    estimatedEffort: 'trivial',
    estimatedImpact: 95,
    falsification:
      'Re-fetch robots.txt and evaluate OAI-SearchBot against it. If the agent is allowed, this finding was wrong.',
  }

  const canonical: Omit<Finding, 'id' | 'fixable' | 'status'> = {
    siteId: SHOWCASE.siteId,
    ruleId: 'TECH-006',
    axis: 'crawl_health',
    severity: 'low',
    confidence: 1,
    title: `${URL}/ has no canonical tag`,
    evidence: {
      kind: 'markup',
      observedAt,
      source: 'crawler',
      url: `${URL}/`,
      locator: 'head',
      snippet: '',
    },
    affectedUrls: [`${URL}/`],
    estimatedEffort: 'small',
    estimatedImpact: 25,
    falsification:
      'Re-fetch the page and look for link[rel="canonical"] in the rendered head. If one is present, this was wrong.',
  }

  const headings: Omit<Finding, 'id' | 'fixable' | 'status'> = {
    siteId: SHOWCASE.siteId,
    ruleId: 'TECH-020',
    axis: 'content',
    severity: 'info',
    confidence: 1,
    title: `${URL}/guides skips a heading level (h1 -> h3)`,
    evidence: {
      kind: 'markup',
      observedAt,
      source: 'crawler',
      url: `${URL}/guides`,
      locator: 'h1, h2, h3, h4, h5, h6',
      snippet: 'h1: Guides\nh3: Planning a first trip',
    },
    affectedUrls: [`${URL}/guides`],
    estimatedEffort: 'trivial',
    estimatedImpact: 5,
    falsification:
      `Re-crawl ${URL}/guides and walk the heading levels in document order. If no ` +
      'level is skipped, this was wrong. Expect no ranking change whatsoever from ' +
      'fixing this. It is for screen reader users, and that is reason enough. Fix this ' +
      'by hand: heading levels are body content spread across the components that render ' +
      'this route, and correcting one in isolation can skip a different level instead.',
  }

  const llms: Omit<Finding, 'id' | 'fixable' | 'status'> = {
    siteId: SHOWCASE.siteId,
    ruleId: 'AGENT-001',
    axis: 'agent_readiness',
    severity: 'low',
    confidence: 1,
    title: `${URL} has no llms.txt`,
    evidence: {
      kind: 'markup',
      observedAt,
      source: 'crawler',
      url: URL,
      locator: '/llms.txt',
      snippet: '',
    },
    affectedUrls: [URL, `${URL}/tours`, `${URL}/about`],
    estimatedEffort: 'trivial',
    estimatedImpact: 20,
    falsification:
      'Fetch /llms.txt at the site root. If it returns a non-empty file, this was wrong. Be ' +
      'honest with the user: llms.txt is agent-readiness infrastructure that helps AI agents ' +
      'and crawlers navigate the site, and Google Search ignores it. Expect no Google ranking ' +
      'change from adding it; the benefit is to agents, and that is reason enough.',
  }

  const sitemap: Omit<Finding, 'id' | 'fixable' | 'status'> = {
    siteId: SHOWCASE.siteId,
    ruleId: 'TECH-003',
    axis: 'crawl_health',
    severity: 'medium',
    confidence: 1,
    title: 'No sitemap is declared in robots.txt',
    evidence: {
      kind: 'markup',
      observedAt,
      source: 'crawler',
      url: URL,
      locator: '/robots.txt',
      snippet: 'robots.txt exists but contains no Sitemap: directive.',
    },
    affectedUrls: [URL],
    estimatedEffort: 'small',
    estimatedImpact: 35,
    falsification:
      'Fetch /robots.txt and look for a Sitemap: line. If one is present, this was wrong. ' +
      'After the fix, Search Console should report the sitemap as discovered and show a ' +
      'non-zero count of discovered URLs.',
  }

  return {
    blocked,
    canonical,
    headings,
    llms,
    sitemap,
    tours: noindexed('/tours', observedAt),
    about: noindexed('/about', observedAt),
    contact: noindexed('/contact', observedAt),
  }
}

const finish = (
  key: string,
  template: Omit<Finding, 'id' | 'fixable' | 'status'>,
  status: Finding['status'] = 'open',
): Finding => {
  const finding: Finding = { ...template, id: key, fixable: false, status }
  return { ...finding, fixable: canFixFinding(finding) }
}

/**
 * The two audits, as the findings each one raised.
 *
 * They tell one story, so the screens that compare audits have something true to compare. The
 * earlier audit raised six issues and the agent opened a pull request for four of them. By the
 * later audit one of those fixes had worked (the page is gone from the list), one had been merged
 * and not yet deployed, one was still in review, and one had been deployed and had not worked.
 * Two new issues turned up in between.
 *
 * Exported so `seed.test.ts` can hold these to the same standard as the first fixture.
 */
export function showcaseDrafts(now: Date = new Date()): { earlier: Finding[]; latest: Finding[] } {
  const then = templates(daysAgo(9, now).toISOString())
  const recent = templates(daysAgo(1, now).toISOString())

  return {
    earlier: [
      finish('TECH-002#0', then.blocked),
      finish('TECH-006#0', then.canonical),
      finish('AGENT-001#0', then.llms, 'pr_open'),
      finish('TECH-003#0', then.sitemap, 'merged'),
      finish('TECH-005#0', then.about, 'verified'),
      finish('TECH-005#1', then.contact, 'rejected'),
    ],
    latest: [
      finish('TECH-002#0', recent.blocked),
      finish('TECH-005#0', recent.tours),
      finish('TECH-006#0', recent.canonical),
      finish('TECH-020#0', recent.headings),
      finish('AGENT-001#0', recent.llms),
      finish('TECH-003#0', recent.sitemap),
      finish('TECH-005#1', recent.contact),
      // What the topic map advises (ADR-0035), from the functions the audit calls: three guide
      // pages that do not link to each other, and the tracked questions no title or heading on
      // this small crawl covers.
      ...evaluateClusterHubs({
        siteId: SHOWCASE.siteId,
        clusters: [{ name: 'Guides', share: 3 / 48, pages: GUIDES }],
        graph: GUIDES.map((url) => ({ url, outbound: [] })),
        nodes: new Map(GUIDES.map((url) => [url, { inboundCount: 1, clickDepth: 2 }])),
        observedAt: recent.blocked.evidence.observedAt,
      }),
      ...evaluateQuestionCoverage({
        siteId: SHOWCASE.siteId,
        siteUrl: URL,
        prompts: QUESTIONS.map((question) => question.prompt),
        pages: CRAWLED_TITLES,
        observedAt: recent.blocked.evidence.observedAt,
      }),
    ],
  }
}

const GUIDES = [`${URL}/guides`, `${URL}/guides/packing`, `${URL}/guides/seasons`]

/** The titles and main headings of the pages the question check is run against. */
const CRAWLED_TITLES = [
  { url: `${URL}/`, title: 'Showcase: small-group walking tours', h1s: ['Walk with local guides'] },
  { url: `${URL}/tours`, title: 'Guided day trips and what they cost', h1s: ['Day trip prices'] },
  { url: `${URL}/guides/packing`, title: 'What to pack for a three-day trek', h1s: ['Packing'] },
]

/** What the agent's pull request for an earlier finding was, by the finding's key. */
const PULL_REQUEST: Record<string, { number: number; resolution: 'merged' | null }> = {
  'AGENT-001#0': { number: 14, resolution: null },
  'TECH-003#0': { number: 12, resolution: 'merged' },
  'TECH-005#0': { number: 9, resolution: 'merged' },
  'TECH-005#1': { number: 7, resolution: 'merged' },
}

/**
 * Five questions over five days on two engines, one of each verdict the page can show.
 *
 * Each entry is how many of that day's two checks cited the site, newest day first. The last
 * question was added yesterday, so it has one day of checks and no verdict yet.
 */
const QUESTIONS: { prompt: string; citedPerDay: number[]; rival?: string }[] = [
  { prompt: 'Which operators run small-group walking tours?', citedPerDay: [2, 2, 1, 2, 1] },
  { prompt: 'How much does a guided day trip cost?', citedPerDay: [1, 0, 1, 0, 1] },
  {
    prompt: 'What should I pack for a three-day trek?',
    citedPerDay: [0, 0, 0, 0, 0],
    rival: SHOWCASE.competitors[0],
  },
  {
    prompt: 'Is travel insurance included with guided tours?',
    citedPerDay: [0, 0, 0, 0, 0],
    rival: SHOWCASE.competitors[1],
  },
  { prompt: 'Are private departures available in the off season?', citedPerDay: [1] },
]

const ENGINES = ['chatgpt', 'perplexity'] as const

/**
 * What the first competitor's pages said a fortnight ago and a week ago.
 *
 * Fed to the real `watchCompetitors` in place of the network, so the rows the competitor page
 * reads are the ones the sweep writes: the diff, the storage bound and the batch timestamps are
 * all the product's own. The change lands three days ago, inside the days the citation checks
 * above cover, so the page has counts on both sides of it and an after-window still running.
 */
const RIVAL = SHOWCASE.competitors[0]
const rivalSnapshot = (week: 'earlier' | 'later'): CompetitorSnapshot => ({
  pages: [
    {
      url: `https://${RIVAL}/`,
      title: 'Rival One: guided walking tours',
      description: 'Small-group walking tours with local guides.',
      h1: 'Walk with people who live here',
    },
    {
      url: `https://${RIVAL}/pricing`,
      title: week === 'earlier' ? 'Pricing' : 'What a guided day costs, and what is included',
      description:
        week === 'earlier'
          ? 'Our prices.'
          : 'Day trips from 85 to 140 per person, with transport, lunch and park fees included.',
      h1: week === 'earlier' ? 'Pricing' : 'What a guided day costs',
    },
  ],
  sitemapUrls: [
    `https://${RIVAL}/`,
    `https://${RIVAL}/pricing`,
    ...(week === 'later' ? [`https://${RIVAL}/packing-list`] : []),
  ],
  note: null,
})

export async function seedShowcase(db: Database, now: Date = new Date()): Promise<void> {
  const earlierAt = daysAgo(9, now)
  const latestAt = daysAgo(1, now)

  // Idempotent: the cascade takes the site, audits, findings, checks and spend with it.
  await asOwner(db, async (tx) => {
    await tx.delete(tenants).where(eq(tenants.id, SHOWCASE.tenantId))
    await tx
      .insert(tenants)
      .values({ id: SHOWCASE.tenantId, name: SHOWCASE.tenant, monthlyBudgetMicros: 5_000_000 })
    await tx
      .insert(apiTokens)
      .values({ tenantId: SHOWCASE.tenantId, name: 'showcase', tokenHash: hash(SHOWCASE.token) })
  })

  const drafts = showcaseDrafts(now)

  /**
   * What the latest audit measured off the page, in the shapes `measureAuthority` and the Search
   * Console read write. Referring domains are a number here because this fixture is the deployment
   * with a backlink index configured; the e2e tenant is the one without.
   */
  const authority = {
    referringDomains: 84,
    referringDomainsSampled: 84,
    earnedDomains: 6,
    selfPublishedDomains: 1,
    unlinkedMentions: [
      'field-notes.example.org',
      'travel-desk.example.net',
      'weekender.example.org',
    ],
    linkGap: {
      editorialDomains: ['trail-review.example.org', 'city-guide.example.net'],
      refusedAsSpam: 12,
      directoryDomains: ['listings.example.org'],
      comparedWith: [...SHOWCASE.competitors],
    },
  }
  const day = (date: Date) => date.toISOString().slice(0, 10)
  const search = {
    clicks: 1_240,
    impressions: 38_200,
    ctr: 1_240 / 38_200,
    position: 14.2,
    startDate: day(daysAgo(31, latestAt)),
    endDate: day(daysAgo(3, latestAt)),
  }

  const earlierScorecard = buildScorecard({
    siteId: SHOWCASE.siteId,
    findings: drafts.earlier,
    coverage: ruleCoverage(),
  })
  const latestScorecard = buildScorecard({
    siteId: SHOWCASE.siteId,
    findings: drafts.latest,
    coverage: {
      ...ruleCoverage(),
      // The note `measureAuthority` writes when mentions were measured, with this fixture's counts.
      authority: {
        checksRun: 1 + SHOWCASE.competitors.length + 2,
        note:
          `Measured from web mentions of "${SHOWCASE.brand}": ${authority.earnedDomains} distinct ` +
          `earned-media domain(s), plus ${authority.selfPublishedDomains} self-published ` +
          'platform(s), counted by domain rather than by result because ten pages on one news ' +
          'site is one publication.',
      },
    },
  })

  await withTenant(db, SHOWCASE.tenantId, async (tx) => {
    await tx.insert(sites).values({
      id: SHOWCASE.siteId,
      tenantId: SHOWCASE.tenantId,
      url: SHOWCASE.siteUrl,
      competitors: [...SHOWCASE.competitors],
      brand: SHOWCASE.brand,
    })

    await tx.insert(audits).values([
      {
        id: SHOWCASE.earlierAuditId,
        tenantId: SHOWCASE.tenantId,
        siteId: SHOWCASE.siteId,
        status: 'complete',
        startedAt: earlierAt,
        completedAt: earlierAt,
        pagesCrawled: 46,
        scorecard: earlierScorecard,
      },
      {
        id: SHOWCASE.latestAuditId,
        tenantId: SHOWCASE.tenantId,
        siteId: SHOWCASE.siteId,
        status: 'complete',
        startedAt: latestAt,
        completedAt: latestAt,
        pagesCrawled: 48,
        scorecard: latestScorecard,
        metrics: { authority, search },
      },
    ])

    const earlierPrints = fingerprintAll(drafts.earlier)
    const latestPrints = fingerprintAll(drafts.latest)
    const seenBefore = new Set(earlierPrints.values())

    const row = (finding: Finding, auditId: string, id: string, fingerprint: string) => ({
      id,
      tenantId: SHOWCASE.tenantId,
      siteId: SHOWCASE.siteId,
      auditId,
      key: finding.id,
      fingerprint,
      ruleId: finding.ruleId,
      axis: finding.axis,
      severity: finding.severity,
      confidence: finding.confidence,
      title: finding.title,
      evidence: finding.evidence,
      affectedUrls: finding.affectedUrls,
      estimatedEffort: finding.estimatedEffort,
      estimatedImpact: finding.estimatedImpact,
      priorityScore: priorityScore(finding),
      falsification: finding.falsification,
      fixable: finding.fixable,
      status: finding.status,
    })

    const earlierIds = new Map(drafts.earlier.map((finding, i) => [finding.id, uuid(10 + i)]))

    await tx.insert(findings).values(
      drafts.earlier.map((finding) => {
        const pr = PULL_REQUEST[finding.id]
        // The snapshot taken when the pull request opened, and the record written when the fix
        // was checked, both from the functions the worker calls at those two moments.
        const baseline = pr ? baselineFor(finding, daysAgo(8, now)) : null
        const decided =
          finding.status === 'verified' || finding.status === 'rejected' ? finding.status : null
        return {
          ...row(
            finding,
            SHOWCASE.earlierAuditId,
            earlierIds.get(finding.id)!,
            earlierPrints.get(finding)!,
          ),
          firstSeenAt: earlierAt,
          createdAt: earlierAt,
          prUrl: pr ? `${REPO}/pull/${pr.number}` : null,
          baseline,
          verification: decided
            ? verificationFor(
                { ...finding, baseline },
                decided,
                // A rejected fix is one the latest audit still raises; a verified one is absent.
                decided === 'rejected' ? drafts.latest : [],
                daysAgo(2, now),
              )
            : null,
        }
      }),
    )

    await tx.insert(findings).values(
      drafts.latest.map((finding, i) => {
        const fingerprint = latestPrints.get(finding)!
        return {
          ...row(finding, SHOWCASE.latestAuditId, uuid(30 + i), fingerprint),
          // An issue the earlier audit also raised was first seen then, not yesterday.
          firstSeenAt: seenBefore.has(fingerprint) ? earlierAt : latestAt,
          createdAt: latestAt,
        }
      }),
    )

    /**
     * One attempt per pull request, which is what the merge and revert rates are counted from.
     * The fifth is a pull request that was closed without merging, so the merge rate is three of
     * four rather than a suspicious four of four.
     */
    await tx.insert(fixAttempts).values([
      ...Object.entries(PULL_REQUEST).map(([key, pr]) => ({
        tenantId: SHOWCASE.tenantId,
        findingId: earlierIds.get(key)!,
        startedAt: daysAgo(8, now),
        finishedAt: daysAgo(8, now),
        outcome: 'pr_opened' as const,
        prUrl: `${REPO}/pull/${pr.number}`,
        prResolution: pr.resolution,
        resolvedAt: pr.resolution ? daysAgo(5, now) : null,
      })),
      {
        tenantId: SHOWCASE.tenantId,
        findingId: earlierIds.get('TECH-002#0')!,
        startedAt: daysAgo(8, now),
        finishedAt: daysAgo(8, now),
        outcome: 'pr_opened' as const,
        prUrl: `${REPO}/pull/5`,
        prResolution: 'closed' as const,
        resolvedAt: daysAgo(6, now),
      },
    ])

    const promptRows = QUESTIONS.map((question, i) => ({
      id: uuid(50 + i),
      tenantId: SHOWCASE.tenantId,
      siteId: SHOWCASE.siteId,
      prompt: question.prompt,
    }))
    await tx.insert(visibilityPrompts).values(promptRows)

    await tx.insert(visibilityChecks).values(
      QUESTIONS.flatMap((question, i) =>
        question.citedPerDay.flatMap((citedThatDay, dayIndex) =>
          ENGINES.map((engine, engineIndex) => {
            const cited = engineIndex < citedThatDay
            return {
              tenantId: SHOWCASE.tenantId,
              siteId: SHOWCASE.siteId,
              promptId: promptRows[i]!.id,
              engine,
              cited,
              basis: 'citations' as const,
              citedCompetitors: question.rival && engineIndex === 0 ? [question.rival] : [],
              sources: cited ? [`${URL}/tours`] : [],
              polledOn: day(daysAgo(dayIndex + 1, now)),
            }
          }),
        ),
      ),
    )

    // $2.25 spent and $0.89 held against a $5.00 cap, so the spend bar has three parts to draw.
    await tx.insert(spend).values(
      [1_400_000, 600_000, 250_000].map((micros) => ({
        tenantId: SHOWCASE.tenantId,
        kind: 'llm',
        provider: 'fixture',
        model: 'fixture',
        micros,
        createdAt: now,
      })),
    )
    await tx
      .insert(schema.spendReservations)
      .values({ tenantId: SHOWCASE.tenantId, reservedMicros: 890_000, createdAt: now })
  })

  // Two runs of the real sweep a week apart. The second competitor refuses the visit in its
  // robots.txt, with the note `takeSnapshot` writes for that, so the page also shows what "looked
  // and could not read" looks like beside one that was read.
  for (const [week, daysBack] of [
    ['earlier', 11],
    ['later', 3],
  ] as const) {
    await watchCompetitors(db, {
      now: daysAgo(daysBack, now),
      siteId: SHOWCASE.siteId,
      snapshot: async (competitor) =>
        competitor === RIVAL
          ? rivalSnapshot(week)
          : {
              pages: [],
              sitemapUrls: [],
              note: `${competitor}'s robots.txt asks crawlers like ours to stay out, so nothing was read.`,
            },
    })
  }
}
