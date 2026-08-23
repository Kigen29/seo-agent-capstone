import type { AuthorityMetrics, AxisCoverage, Finding } from '@seo/core'
import {
  classifyMentions,
  evaluateAuthority,
  mentionQuery,
  SerpBudgetError,
  type BacklinkProvider,
  type SerpProvider,
} from '@seo/connectors'

/**
 * How many rivals we will pay to compare against.
 *
 * Every competitor is one more billable query on every audit, so this is a cost decision wearing
 * a product decision's clothes. Three is enough to know whether you are behind: a client who is
 * out-mentioned by their top three rivals does not need a fourth data point to know they have a
 * problem, and one who leads all three is not going to change plans because a seventh rival also
 * trails them.
 */
export const MAX_COMPARED_COMPETITORS = 3

export interface AuthorityResult {
  findings: Finding[]
  /** True only when the mention query actually ran and returned. */
  measured: boolean
  coverage: AxisCoverage
  /**
   * The figures, kept rather than only described in the coverage note.
   *
   * Absent when nothing was measured. Present, it always carries `referringDomains`, which is
   * null when no backlink index is configured: that null is the difference between a site with no
   * backlinks and a deployment that never looked, and collapsing the two is the one thing this
   * axis must not do (ADR-0018).
   */
  metrics?: AuthorityMetrics
}

/** The axis's honest state when we did not, or could not, measure it. */
const unmeasured = (note: string): AuthorityResult => ({
  findings: [],
  measured: false,
  coverage: { checksRun: 0, note },
})

/**
 * Measure the authority axis: where the web mentions this brand.
 *
 * The axis leads with mentions and reports referring domains as unmeasured, which is the opposite
 * of how every other tool orders it, and it is the ordering the evidence supports. Branded web
 * mentions correlate 0.664 with AI Overview visibility; backlinks correlate 0.218. We do not have
 * a backlink index, and rather than showing a zero that reads as "no backlinks", the axis says it
 * has no source for them. A zero and an absence look identical on a dashboard and mean opposite
 * things.
 *
 * Every query here is billed and passes the per-tenant budget guard before it is made (ADR-0016,
 * ADR-0017). Running out of budget mid-measurement is not an error: it degrades the axis to
 * unmeasured with a note, which is the same posture a missing key gets.
 */
/**
 * How referring domains are described when there is no backlink index configured.
 *
 * One sentence, in one place, because it appears on three different paths out of this function and
 * three copies would drift the moment one of them was updated. It is also the sentence this
 * product has been deliberately saying since Sprint 3, and it stays exactly as it was for any
 * operator who has not configured an index (ADR-0018).
 */
const NO_BACKLINK_INDEX =
  'Referring domains are NOT measured, because no backlink index is configured ' +
  '(set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD); that is an absence of data, not a zero.'

export async function measureAuthority(
  options: {
    siteId: string
    /** The brand as a human writes it. Null when nobody has told us yet. */
    brand: string | null
    /** The client's own site, so their own pages are excluded from earned media. */
    domain: string
    competitors: readonly string[]
  },
  provider?: SerpProvider,
  /**
   * A backlink index, when one is configured. Optional, and the axis works without it exactly as
   * it did before: links are a second signal here, never the lead (ADR-0018).
   */
  backlinks?: BacklinkProvider,
): Promise<AuthorityResult> {
  if (!provider) {
    return unmeasured(
      'Not measured. Brand mentions come from a SERP data source, which is the one paid ' +
        'dependency in the product and is off by default (set SERPAPI_API_KEY). ' +
        NO_BACKLINK_INDEX,
    )
  }

  if (!options.brand?.trim()) {
    return unmeasured(
      'Not measured. Set the brand name for this site. It cannot be derived from the domain: ' +
        'searching for "heartbeestsafaris" finds almost nothing when the press writes ' +
        '"Heartbeest Safaris", and guessing the spaces back in would under-count every ' +
        'multi-word brand.',
    )
  }

  const brand = options.brand.trim()

  try {
    const own = await provider.mentions(mentionQuery(brand, options.domain))
    const footprint = classifyMentions(own.sources, options.domain)

    /**
     * Competitors are compared on the same instrument: the same query shape, the same exclusion
     * of their own site, the same distinct-domain count. Comparing our earned domains against a
     * rival's raw result count would be a number that always flatters whoever was measured more
     * generously.
     *
     * One at a time, and settled individually, so one rival's failed query costs that comparison
     * and not the whole axis.
     */
    const compared = options.competitors.slice(0, MAX_COMPARED_COMPETITORS)
    const rivals = await Promise.allSettled(
      compared.map(async (domain) => {
        const result = await provider.mentions(mentionQuery(domain, domain))
        return {
          domain,
          earnedDomains: classifyMentions(result.sources, domain).earnedDomains.length,
        }
      }),
    )

    const competitors = rivals
      .filter(
        (entry): entry is PromiseFulfilledResult<{ domain: string; earnedDomains: number }> =>
          entry.status === 'fulfilled',
      )
      .map((entry) => entry.value)

    /**
     * The link index, when there is one, and never at the cost of the axis when there is not.
     *
     * Settled rather than awaited directly: mentions are the lead signal and they have already
     * succeeded by this point, so a backlink vendor being down must degrade links to unmeasured
     * rather than throw away a measurement we have paid for and hold.
     */
    const links = backlinks
      ? await backlinks.referringDomains(options.domain).catch(() => undefined)
      : undefined

    const report = evaluateAuthority({
      siteId: options.siteId,
      brand,
      footprint,
      competitors,
      ...(links ? { backlinks: links } : {}),
    })

    return {
      findings: report.findings,
      measured: true,
      metrics: {
        referringDomains: links ? links.total : null,
        ...(links ? { referringDomainsSampled: links.domains.length } : {}),
        earnedDomains: report.earnedCount,
        selfPublishedDomains: footprint.selfPublishedDomains.length,
        ...(report.unlinkedMentions ? { unlinkedMentions: report.unlinkedMentions } : {}),
      },
      coverage: {
        // One check per thing we actually looked at: the brand, each rival that answered, and the
        // link index when it was consulted.
        checksRun: 1 + competitors.length + (links ? 1 : 0),
        note:
          `Measured from web mentions of "${brand}": ${report.earnedCount} distinct earned-media ` +
          `domain(s), plus ${footprint.selfPublishedDomains.length} self-published platform(s), ` +
          `counted by domain rather than by result because ten pages on one news site is one ` +
          `publication. Mentions lead this axis on purpose: they correlate 0.664 with AI ` +
          `Overview visibility where backlinks correlate 0.218, and 84% of AI citations come ` +
          `from earned media. ` +
          (links
            ? `Referring domains are a second signal, not the lead: ${links.total} domain(s) ` +
              `link to ${links.target}` +
              (report.unlinkedMentions && report.unlinkedMentions.length > 0
                ? `, and ${report.unlinkedMentions.length} domain(s) mention the brand without ` +
                  `linking to it, which is the cheapest link work available here.`
                : `, and every earned-media domain that mentions the brand already links to it.`)
            : NO_BACKLINK_INDEX),
      },
    }
  } catch (error) {
    // Out of budget is the expected way for this to stop, not a malfunction, so it says so
    // plainly. Everything else degrades the same way for the same reason: the crawl succeeded and
    // the other axes are real, so losing this one for a run beats failing the whole audit.
    const why =
      error instanceof SerpBudgetError
        ? `this tenant is at its monthly budget, so no paid query was made (${error.message})`
        : 'the SERP request failed'

    return unmeasured(
      `Not measured this run: ${why}. The rest of the audit is unaffected. ` +
        (backlinks
          ? 'Referring domains were not reached either: this axis leads with mentions, and ' +
            'without them there is nothing for a link count to be a second signal to.'
          : NO_BACKLINK_INDEX),
    )
  }
}
