import type { VisibilityReport } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { InfoHint } from '@/components/ui/info-hint'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { QuestionMiner } from './question-miner'
import { percent, QuestionsTable, ShareTable } from './report-tables'
import { VisibilityPrompts } from './tracked-questions'
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
  let site
  try {
    sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
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
        title="Do AI assistants mention you?"
        description="Whether ChatGPT, Google's AI answers and similar assistants mention your site when customers ask about what you offer. Each question is checked several times over a few days before a mention counts, because their answers change from day to day."
      />

      {/*
        Nothing configured is not a measurement, so it does not get a row of figures.
        "0 of 0 prompts", "0 checks", "0 of 14 days" is four zeros a reader scans before reaching
        the sentence that explains them, and DESIGN.md says an unmeasured thing renders its reason
        rather than a zero. This is that rule applied to the page that most needs it.

        Once prompts exist the figures come back even without a verdict, because then they are real
        progress: three checks over two days is the axis working, not the axis empty.
      */}
      {report && report.promptsConfigured === 0 && (
        <EmptyState
          figure="?"
          title="No questions tracked yet"
          action={
            // The editor lives on this page now; the old link went to the dashboard, which no longer
            // has it.
            <a href="#questions" className="btn btn-primary">
              Choose questions
            </a>
          }
        >
          Pick the questions your customers ask, and daily checks start. The agent can suggest them.
        </EmptyState>
      )}

      {report && report.promptsConfigured > 0 && (
        <>
          <StatRow>
            <Stat
              label="Questions with an answer"
              value={`${report.promptsMeasured} of ${report.promptsConfigured}`}
              hint="Checked often enough to call"
            />
            <Stat
              label="Checks run"
              value={report.checksRun.toLocaleString('en-US')}
              hint="One per question, per engine, per day"
            />
            <Stat
              label="Days checked"
              value={`${report.daysPolled} of ${report.windowDays}`}
              hint="A verdict needs at least three"
            />
            <Stat
              label="Share of voice"
              hint="Your part of all citations"
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
            Present exactly when there is nothing to report yet, and it says which kind of nothing:
            configured but never polled, or polling and short of a verdict.
          */}
          {report.note && (
            <Note tone="warn" className="mb-6">
              {report.note}
            </Note>
          )}

          {report.prompts.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="h-section m-0">Question by question</h2>
                <span className="text-muted text-[12px]">Last {report.windowDays} days</span>
              </div>
              <QuestionsTable prompts={report.prompts} />
            </section>
          )}

          {report.share && (
            <section className="mb-6">
              <div className="mb-1 flex items-center gap-1">
                <h2 className="h-section m-0">Share of voice</h2>
                <InfoHint label="share of voice">
                  Every time an AI answer cited you or one of your competitors counts as one
                  citation. Share of voice is the part of those that went to you. It only compares
                  you with the competitors you chose, so adding or removing one changes the figure.
                </InfoHint>
              </div>
              <div className="text-muted mb-3 max-w-[68ch] text-sm">
                How often AI answers cited you, beside how often they cited each competitor.
                {site && (
                  <>
                    {' '}
                    Competitors are chosen on{' '}
                    <Link href={`/site?siteId=${site.id}`}>site setup</Link>.
                  </>
                )}
              </div>
              <ShareTable
                share={report.share}
                you={site ? site.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : ''}
              />
            </section>
          )}

          {report.engines.length > 0 && (
            <p className="text-muted m-0 text-[13px]">
              Checked on {report.engines.join(', ')}, over the last {report.windowDays} days.
            </p>
          )}
        </>
      )}

      {/*
        Outside the report block on purpose. The case that needs this most is the site with no
        prompts at all, where the report renders its empty state and a person is looking at a
        button that asks them to invent questions from memory.
      */}
      {site && <QuestionMiner siteId={site.id} />}

      {/*
        Questions only. The brand name and the competitors used to be edited here too, behind a
        button labelled for questions; they are facts about the site that three other pages read,
        so they live on the site setup page and this links to it.
      */}
      {site && (
        <section className="mt-8">
          <h2 className="h-section mb-1">Tracked questions</h2>
          <div className="text-muted mb-3 max-w-[68ch] text-sm">
            Remove a question or add your own. Competitors and your brand name are on{' '}
            <Link href={`/site?siteId=${site.id}`}>site setup</Link>.
          </div>
          <VisibilityPrompts siteId={site.id} />
        </section>
      )}
    </main>
  )
}
