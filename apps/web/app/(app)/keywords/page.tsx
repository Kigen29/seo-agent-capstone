import type { KeywordIdeasResult } from '@seo/api-client'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
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
  searchParams: Promise<{ seed?: string; country?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { seed, country } = await searchParams

  let result: KeywordIdeasResult | undefined
  let failed: string | undefined

  if (seed?.trim()) {
    try {
      result = await api.keywordIdeas({ seed: seed.trim(), ...(country ? { country } : {}) })
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

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Research"
        title="What are people actually searching for?"
        description="Ideas around a seed term, with real monthly search volume. Every search is a billed query against a paid data source, so it runs when you ask and not before."
      />

      <SeedForm seed={seed ?? ''} country={country ?? ''} />

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
            No ideas for &ldquo;{result.seed}&rdquo;. The seed may be too narrow, too unusual, or
            not something people search for in that market.
          </EmptyState>
        </div>
      )}

      {result && result.ideas.length > 0 && (
        <section className="mt-6">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Monthly searches</th>
                  <th>Ad competition</th>
                  <th>Cost per click</th>
                </tr>
              </thead>
              <tbody>
                {[...result.ideas]
                  .sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1))
                  .map((idea) => (
                    <tr key={idea.keyword}>
                      <td>{idea.keyword}</td>
                      {/*
                        A dash, never a zero. The vendor not reporting a volume and a keyword
                        nobody searches for are different facts, and only one of them is a reason
                        to drop the keyword.
                      */}
                      <td className="tnum">
                        {idea.searchVolume === null ? (
                          <span className="text-subtle">&mdash;</span>
                        ) : (
                          idea.searchVolume.toLocaleString('en-US')
                        )}
                      </td>
                      <td className="tnum">
                        {idea.competition === null ? (
                          <span className="text-subtle">&mdash;</span>
                        ) : (
                          idea.competition.toFixed(2)
                        )}
                      </td>
                      <td className="tnum">
                        {idea.cpc === null ? (
                          <span className="text-subtle">&mdash;</span>
                        ) : (
                          `$${idea.cpc.toFixed(2)}`
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

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
          <EmptyState figure="?" title="Start with a term you want to rank for">
            Type a seed above. A product, a service, a question your customers ask.
          </EmptyState>
        </div>
      )}
    </main>
  )
}
