import type { KeywordGapResult, KeywordIdeasResult, Site } from '@seo/api-client'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { countryFromUrl, isCountryCode } from '@/lib/countries'
import { getClient } from '@/lib/session'
import { GapForm } from './gap-form'
import { GapTable, IdeasTable } from './keyword-tables'
import { SeedForm } from './seed-form'

export const dynamic = 'force-dynamic'

/**
 * Keyword research.
 *
 * The endpoint, the budget guard and the typed client method all shipped with the DataForSEO seam
 * and only the MCP server ever called them, so this page is the cheapest half of closing the gap
 * between what the product measures and what it shows.
 *
 * The seed lives in the query string rather than in component state, and that is not incidental:
 * a search worth running is worth linking to, and every one of these costs money. A result you
 * cannot bookmark is a result somebody pays for twice.
 */
export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; country?: string; competitor?: string; siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { seed, country, competitor, siteId } = await searchParams

  let result: KeywordIdeasResult | undefined
  let gap: KeywordGapResult | undefined
  let site: Site | undefined
  let failed: string | undefined

  /**
   * The gap is measured against a site, because the correction that makes it worth reading is
   * that site's own Search Console data. With no site there is nothing to subtract from and the
   * form is not offered at all.
   */
  try {
    const sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  /**
   * The market every query uses: the one in the URL when it is a real country, else the one the
   * site's own domain points at (soliangirls.sc.ke is Kenya), else the United States, the data
   * vendor's own default. Always sent, so the page never measures a market the person did not see
   * selected in the form.
   */
  const market = isCountryCode(country)
    ? country.toLowerCase()
    : (countryFromUrl(site?.url) ?? 'us')

  if (seed?.trim()) {
    try {
      result = await api.keywordIdeas({ seed: seed.trim(), country: market })
    } catch (error) {
      // A 429 here is the budget guard doing its job, not a broken page: the tenant is at its cap
      // and the honest answer is to say so and leave the form usable.
      const status = (error as { status?: number }).status
      if (status === 429) {
        failed = (error as { message?: string }).message ?? 'This tenant is at its monthly budget.'
      } else {
        handleApiError(error)
        return <ApiAsleep />
      }
    }
  }

  if (site && competitor?.trim()) {
    try {
      gap = await api.keywordGap({
        siteId: site.id,
        competitor: competitor.trim(),
        country: market,
      })
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 429) {
        failed = (error as { message?: string }).message ?? 'This tenant is at its monthly budget.'
      } else {
        handleApiError(error)
        return <ApiAsleep />
      }
    }
  }

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Research"
        title="What are people actually searching for?"
        description="Type a word your customers might search for, choose their country, and see related searches with how many people make them each month. Use it to decide which pages to write and what to call them. Each search is a small billed query, so it runs only when you press Search."
      />

      <SeedForm seed={seed ?? ''} country={market} />

      {failed && (
        <Note tone="error" role="alert" className="mt-6">
          {failed}
        </Note>
      )}

      {result?.note && (
        <Note tone="warn" className="mt-6">
          {result.note}
        </Note>
      )}

      {result && !result.note && result.ideas.length === 0 && (
        <div className="mt-6">
          <EmptyState figure="0" title="Nothing came back">
            No related searches for &ldquo;{result.seed}&rdquo;. It may be too narrow, too unusual,
            or not something people search for in that country. Try a shorter or more general
            phrase.
          </EmptyState>
        </div>
      )}

      {result && result.ideas.length > 0 && (
        <section className="mt-6">
          <IdeasTable ideas={result.ideas} />

          {/*
            Said plainly, and said every time. The industry renders this column as "difficulty" and
            lets a reader plan organic work around how many advertisers bid on a term, which is a
            different question with a different answer.
          */}
          <p className="text-muted mt-3 mb-0 text-[13px]">
            Ad competition is how many advertisers bid on the term, not how hard it is to rank for
            organically. It comes from advertising data and says nothing about the pages you would
            be competing with.
          </p>
        </section>
      )}

      {!seed?.trim() && (
        <div className="mt-6">
          <EmptyState figure="?" title="Start with a word your customers would search">
            Type it above: a product, a service, or a question your customers ask.
          </EmptyState>
        </div>
      )}

      {site && (
        <section className="mt-10">
          <h2 className="h-section mb-1">What a competitor ranks for and you do not</h2>
          <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
            Enter a competitor&apos;s site to see searches they appear for and {site.url} does not.
            Searches you already appear for in your own Search Console are left out, so the list is
            only real opportunities.
          </p>

          <GapForm competitor={competitor ?? ''} country={market} seed={seed ?? ''} />

          {gap?.note && (
            <Note tone="warn" className="mt-4">
              {gap.note}
            </Note>
          )}

          {gap && gap.subtracted !== null && (
            <p className="text-muted mt-3 mb-0 text-[13px]">
              {gap.subtracted === 0
                ? 'Checked against your Search Console: you do not already appear for any of these.'
                : `${gap.subtracted} ${gap.subtracted === 1 ? 'search was' : 'searches were'} left out because your Search Console shows you already appear for ${gap.subtracted === 1 ? 'it' : 'them'}.`}
            </p>
          )}

          {gap && !gap.note && gap.keywords.length === 0 && (
            <div className="mt-4">
              <EmptyState figure="0" title="No gap found">
                Nothing {gap.competitor} ranks for is missing from your site, at least in this
                country and among the results we looked up.
              </EmptyState>
            </div>
          )}

          {gap && gap.keywords.length > 0 && <GapTable keywords={gap.keywords} />}

          {gap && gap.keywords.length > 0 && (
            /*
              Said rather than filtered, and the live data is why. Against a Kenyan tile retailer
              this list came back with "tile and carpet nairobi" and "tacc lavington": the rival's
              own brand. A filter for brand terms would have to drop the words in their domain,
              and for a tile shop those words are "tile" and "carpet", which are the entire
              category. Removing them would delete the useful half of the list to tidy the rest.
            */
            <p className="text-muted mt-3 mb-0 text-[13px]">
              Some of these will be {gap.competitor}&rsquo;s own brand searches, which you cannot
              rank for and should skip. They are left in because filtering them would mean dropping
              the words in their domain name, and those are often the words for the product itself.
            </p>
          )}
        </section>
      )}
    </main>
  )
}
