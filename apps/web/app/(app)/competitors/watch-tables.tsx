import type { CompetitorChange, CompetitorWatch } from '@seo/api-client'
import { DataTable } from '@/components/ui/data-table'
import { OutboundLink, pathOf } from '@/components/ui/outbound-link'
import { citationSentence, COINCIDENCE_NOTE } from '@/lib/citation-sentence'
import { formatDay } from '@/lib/format'

/**
 * The two tables on the competitor watch: who is being read, and what they changed.
 *
 * Out of the page file so that file is the page (what is fetched, what is shown when there is
 * nothing) and this is the rows. Both are the shared `<DataTable>`, so a tenth competitor or a
 * fortieth batch of changes pages like every other list instead of running down the screen.
 */

const KIND: Record<CompetitorChange['kind'], string> = {
  title: 'Title',
  description: 'Meta description',
  h1: 'Main heading',
  new_url: 'New page',
}

/** Each competitor and the state of its last reading. */
export function WatchedTable({ competitors }: { competitors: CompetitorWatch['competitors'] }) {
  return (
    <DataTable
      label="Competitors being watched"
      columns={[{ header: 'Competitor' }, { header: 'Last reading' }]}
      rows={competitors.map((competitor) => ({
        key: competitor.domain,
        cells: [
          <span key="domain" className="break-all">
            {competitor.domain}
          </span>,
          /*
            Three different answers, and none of them is a zero: not looked at yet, looked and
            could not read, and read.
          */
          <span key="reading" className="text-muted">
            {competitor.lastSnapshotAt === null
              ? 'Not read yet. The first snapshot is taken on the next weekly run.'
              : (competitor.note ??
                `Read ${formatDay(competitor.lastSnapshotAt)}, ${competitor.pagesRead} page${competitor.pagesRead === 1 ? '' : 's'}`)}
          </span>,
        ],
      }))}
    />
  )
}

/** One thing that differed between two readings: what kind, on which page, and the two values. */
function Change({ change }: { change: CompetitorChange }) {
  return (
    <li className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="tag tag-neutral">{KIND[change.kind]}</span>
        <OutboundLink href={change.url} className="rule-id m-0">
          {pathOf(change.url)}
        </OutboundLink>
      </div>
      {change.kind !== 'new_url' && (
        <dl className="m-0 mt-1.5 grid gap-1 text-sm sm:grid-cols-[3rem_1fr]">
          <dt className="stat-label pt-0.5">Was</dt>
          <dd className="text-muted m-0">
            {change.before ?? <span className="text-subtle">Not present</span>}
          </dd>
          <dt className="stat-label pt-0.5">Now</dt>
          <dd className="m-0">{change.after ?? <span className="text-subtle">Removed</span>}</dd>
        </dl>
      )}
    </li>
  )
}

/**
 * One row per reading that found something: who, when, what changed, and their AI citations
 * either side of it.
 *
 * The last column is two counts and a sentence saying what they are not. It is written by
 * `citationSentence`, whose own test fails on any causal word, because a change and a count that
 * happen to sit in one row are exactly what gets read as cause and effect (ADR-0034).
 */
export function ChangesTable({
  batches,
  windowDays,
}: {
  batches: CompetitorWatch['batches']
  windowDays: number
}) {
  return (
    <DataTable
      label="What competitors changed"
      pageSize={5}
      columns={[
        { header: 'Competitor' },
        { header: 'What changed' },
        { header: 'Their AI citations, before and after', className: 'max-w-[34ch]' },
      ]}
      rows={batches.map((batch) => ({
        key: `${batch.competitor}-${batch.detectedAt}`,
        cells: [
          <div key="who">
            <div className="font-semibold break-all">{batch.competitor}</div>
            <div className="text-muted mt-0.5 text-[13px]">
              {batch.changes.length} change{batch.changes.length === 1 ? '' : 's'}, seen{' '}
              {formatDay(batch.detectedAt)}
            </div>
          </div>,
          <ul key="changes" className="m-0 flex list-none flex-col gap-3 p-0">
            {batch.changes.map((change) => (
              <Change key={`${change.kind}-${change.url}`} change={change} />
            ))}
          </ul>,
          <div key="citations" className="text-[13px]">
            <span style={{ color: 'var(--color-text)' }}>
              {citationSentence(
                batch.citationsBefore,
                batch.citationsAfter,
                windowDays,
                batch.afterComplete,
              )}
            </span>{' '}
            <span className="text-muted">
              {(batch.citationsBefore.checks > 0 || batch.citationsAfter.checks > 0) &&
                COINCIDENCE_NOTE}
            </span>
          </div>,
        ],
      }))}
    />
  )
}
