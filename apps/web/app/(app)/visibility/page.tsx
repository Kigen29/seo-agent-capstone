import type { PromptSummary, VisibilityReport } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * AI visibility: are the answer engines citing you, and how reliably.
 *
 * This is the screen the Sprint 3 demo has always asked for. The numbers on it have been computed
 * on every audit since that sprint and discarded, because the axis kept only a paragraph.
 *
 * The whole page is built around one refusal. A citation is a claim about a distribution, not
 * about one answer: roughly 45% of citations appear in only one of three checks, so a prompt with
 * two polls has no verdict and this page says so rather than showing a number that would be read
 * as one. Every count is rendered as "k of N", never as a bare percentage, because the sample is
 * the honesty.
 */

/** How a stability verdict should read, and what it means. Never a bare word on its own. */
const STABILITY: Record<
  PromptSummary['stability'],
  { label: string; className: string; help: string }
> = {
  stable: {
    label: 'Cited',
    className: 'tag tag-success',
    help: 'Cited consistently enough across the window to report as a citation.',
  },
  unstable: {
    label: 'Cited unstably',
    className: 'tag tag-warn',
    help: 'Cited in some checks and not others. Real, but not something to rely on.',
  },
  absent: {
    label: 'Not cited',
    className: 'tag tag-critical',
    help: 'Polled enough to be sure: the engines are not citing you for this.',
  },
  insufficient: {
    label: 'Still polling',
    className: 'tag tag-neutral',
    help: 'Not enough checks, or not over enough days, to say anything yet.',
  },
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`

export default async function VisibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId } = await searchParams

  let sites
  let report: VisibilityReport | undefined
  try {
    sites = await api.listSites()
    const site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site) report = await api.getVisibilityReport(site.id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (sites.length === 0) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="Research" title="AI visibility" />
        <EmptyState
          figure="0"
          title="No sites yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Add a site
            </Link>
          }
        >
          Add a site and tell it which questions your customers ask, and the daily poll starts.
        </EmptyState>
      </main>
    )
  }

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Research"
        title="Do the answer engines cite you?"
        description="Every prompt is polled repeatedly across several days. A citation is only reported when it holds up across the window, because about 45% of citations appear in only one of three checks."
      />

      {report && (
        <>
          <StatRow>
            <Stat
              label="Prompts with a verdict"
              value={`${report.promptsMeasured} of ${report.promptsConfigured}`}
            />
            <Stat label="Checks run" value={report.checksRun.toLocaleString('en-US')} />
            <Stat label="Days polled" value={`${report.daysPolled} of ${report.windowDays}`} />
            <Stat
              label="Share of voice"
              value={
                report.share ? (
                  percent(report.share.clientShare)
                ) : (
                  <span className="text-subtle">&mdash;</span>
                )
              }
            />
          </StatRow>

          {/*
            The note is present exactly when there is nothing to report, and it says which kind of
            nothing: no prompts, none polled, or polling but short of a verdict. Rendering a zero
            here instead would be the single most damaging thing this page could do.
          */}
          {report.note && (
            <Note tone="warn" className="mb-6">
              {report.note}
            </Note>
          )}

          {report.prompts.length > 0 && (
            <section className="mb-6">
              <h2 className="h-section mb-3">Per prompt</h2>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Question we asked</th>
                      <th>Cited</th>
                      <th>Over</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.prompts.map((prompt) => {
                      const verdict = STABILITY[prompt.stability]
                      return (
                        <tr key={prompt.prompt}>
                          <td>{prompt.prompt}</td>
                          {/*
                            "2 of 6", never "33%". The sample is what makes the number checkable,
                            and a percentage hides whether it rests on three polls or thirty.
                          */}
                          <td className="tnum whitespace-nowrap">
                            {prompt.citedCount} of {prompt.pollsRun}
                          </td>
                          <td className="tnum whitespace-nowrap">
                            {prompt.daysPolled} day{prompt.daysPolled === 1 ? '' : 's'}
                          </td>
                          <td className="whitespace-nowrap">
                            <span className={verdict.className}>{verdict.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/*
                A visible legend rather than a `title` tooltip on each tag. `title` on a
                non-interactive span reaches a mouse and nothing else: no keyboard, no screen
                reader, no touch. Four short definitions in the open serve everyone and cost a
                line.
              */}
              <dl className="text-muted mt-3 mb-0 grid gap-1 text-[13px] sm:grid-cols-2">
                {Object.values(STABILITY).map((verdict) => (
                  <div key={verdict.label} className="flex min-w-0 gap-2">
                    <dt className="shrink-0 font-[600]">{verdict.label}:</dt>
                    <dd className="m-0 min-w-0">{verdict.help}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {report.share && (
            <section className="mb-6">
              <h2 className="h-section mb-3">Share of voice</h2>
              <div className="card elev-sm gap-3 p-4">
                <p className="text-muted m-0 text-sm">
                  Citations across every check in the window, yours against the competitors this
                  site is configured to watch.
                </p>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  <li className="flex items-baseline justify-between gap-4">
                    <span className="font-[600]">You</span>
                    <span className="tnum">
                      {report.share.client} citation{report.share.client === 1 ? '' : 's'} ·{' '}
                      {percent(report.share.clientShare)}
                    </span>
                  </li>
                  {report.share.competitors.map((competitor) => (
                    <li
                      key={competitor.domain}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <span className="min-w-0 truncate">{competitor.domain}</span>
                      <span className="tnum shrink-0">
                        {competitor.citations} citation{competitor.citations === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {report.engines.length > 0 && (
            <p className="text-muted m-0 text-[13px]">
              Polled on {report.engines.join(', ')}, over the last {report.windowDays} days.
            </p>
          )}
        </>
      )}
    </main>
  )
}
