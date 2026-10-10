import type { PromptSummary, VisibilityReport } from '@seo/api-client'
import { DataTable } from '@/components/ui/data-table'
import { Legend } from '@/components/ui/legend'

/**
 * The two tables on the AI visibility page: each question's verdict, and share of voice.
 *
 * Out of the page file so the page is what is fetched and what is said when nothing is measured,
 * and this is the rows.
 */

/**
 * The four verdicts a question can have, in the order of how much is known.
 *
 * In one place because the table and the key under it must use the same words for them: a tag
 * reading "Cited unstably" beside a legend that explained "Unstable" would be two vocabularies
 * for one thing.
 */
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
    help: 'Checked enough times to be sure: the engines do not cite you for this.',
  },
  insufficient: {
    label: 'Still checking',
    className: 'tag tag-neutral',
    help: 'Not enough checks, or not over enough days, to say anything yet.',
  },
}

export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`

/** Every tracked question with its counts and its verdict, and the key to the verdicts. */
export function QuestionsTable({ prompts }: { prompts: PromptSummary[] }) {
  return (
    <>
      <DataTable
        label="Tracked questions and whether you are cited"
        columns={[
          { header: 'Question we asked' },
          { header: 'Cited', align: 'end' },
          { header: 'Over', align: 'end' },
          { header: 'Verdict', align: 'end' },
        ]}
        rows={prompts.map((prompt) => ({
          key: prompt.prompt,
          cells: [
            prompt.prompt,
            /*
              "2 of 6", never "33%". The sample is what makes the number checkable, and a
              percentage hides whether it rests on three checks or thirty.
            */
            <span key="cited" className="tnum text-muted whitespace-nowrap">
              {prompt.citedCount} of {prompt.pollsRun}
            </span>,
            <span key="days" className="tnum text-muted whitespace-nowrap">
              {prompt.daysPolled} day{prompt.daysPolled === 1 ? '' : 's'}
            </span>,
            <span
              key="verdict"
              className={`${STABILITY[prompt.stability].className} whitespace-nowrap`}
            >
              {STABILITY[prompt.stability].label}
            </span>,
          ],
        }))}
      />
      <Legend
        className="mt-3"
        items={Object.values(STABILITY).map((verdict) => ({
          term: verdict.label,
          meaning: verdict.help,
        }))}
      />
    </>
  )
}

/** How often AI answers cited the client, beside each competitor. The client's row leads. */
export function ShareTable({
  share,
  you,
}: {
  share: NonNullable<VisibilityReport['share']>
  /** The client's own site, as a bare host. */
  you: string
}) {
  const total =
    share.client + share.competitors.reduce((sum, competitor) => sum + competitor.citations, 0)

  return (
    <DataTable
      label="Share of voice against your competitors"
      columns={[
        { header: 'Who' },
        { header: 'Site' },
        { header: 'Citations', align: 'end' },
        { header: 'Share', align: 'end' },
      ]}
      rows={[
        {
          key: 'you',
          cells: [
            <span key="who" className="card-kicker">
              You
            </span>,
            <span key="site" className="break-all">
              {you}
            </span>,
            <span key="count" className="tnum">
              {share.client}
            </span>,
            <span key="share" className="tnum">
              {percent(share.clientShare)}
            </span>,
          ],
        },
        ...share.competitors.map((competitor) => ({
          key: competitor.domain,
          cells: [
            <span key="who" className="stat-label">
              Competitor
            </span>,
            <span key="site" className="break-all">
              {competitor.domain}
            </span>,
            <span key="count" className="tnum">
              {competitor.citations}
            </span>,
            // The same sum the client's share comes from: this site's citations over everybody's.
            <span key="share" className="tnum text-muted">
              {total > 0 ? percent(competitor.citations / total) : percent(0)}
            </span>,
          ],
        })),
      ]}
    />
  )
}
