import type { Audit, Site, VisibilityReport } from '@seo/api-client'
import type { Severity } from '@seo/core'
import Link from 'next/link'
import { severityLabel } from '@/components/severity'
import { AXIS_LABEL } from '@/app/(app)/findings/labels'

/**
 * The overview: what this site's state actually is, before anything asks you to do something.
 *
 * The dashboard was a list of sites with an Add-site form at the top, which meant the first screen
 * of a product that measures eight axes showed none of them. These four cards are all built from
 * data already fetched or one call away, and every one of them can say "not measured" rather than
 * inventing a figure, because on several of these axes that is the true answer far more often than
 * a number is.
 */

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/**
 * A card, so the grid is one shape rather than five hand-rolled ones.
 *
 * Three bands: a small title with the way through to the detail, the figures, and a footer that
 * says what the figures rest on. The footer is pinned to the bottom, so two cards side by side
 * line their rules up whatever each one holds.
 */
function Card({
  title,
  href,
  linkLabel,
  foot,
  children,
}: {
  title: string
  href?: string
  linkLabel?: string
  foot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className="card"
      style={{ padding: 'var(--space-5)', gap: 'var(--space-4)', minHeight: 200 }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-heading">{title}</h2>
        {href && (
          <Link href={href} className="shrink-0 text-[13px]">
            {linkLabel ?? 'More'} &rarr;
          </Link>
        )}
      </div>
      {children}
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  )
}

/** A label over a figure. Tabular, so a row of them does not wobble as values change. */
function Figure({
  label,
  value,
  large = false,
}: {
  label: string
  value: React.ReactNode
  large?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="stat-label">{label}</div>
      <div className={large ? 'stat-value' : 'stat-value stat-value-sm'}>{value}</div>
    </div>
  )
}

/** The em dash and the reason, for anything genuinely unmeasured. Never a zero. */
function NotMeasured({ reason }: { reason: string }) {
  return (
    <p className="text-subtle m-0 text-[13px]">
      <span aria-hidden="true">&mdash; </span>
      {reason}
    </p>
  )
}

/** A dash that a screen reader hears as what it means. */
const dash = (
  <span className="text-subtle">
    &mdash;<span className="sr-only">Not measured</span>
  </span>
)

export function Overview({
  site,
  audit,
  visibility,
}: {
  site: Site
  audit?: Audit
  visibility?: VisibilityReport
}) {
  const scorecard = audit?.scorecard ?? site.latestAudit?.scorecard ?? null
  const totals = scorecard?.totals ?? {}
  const openFindings = SEVERITIES.reduce((sum, severity) => sum + (totals[severity] ?? 0), 0)
  const raised = SEVERITIES.filter((severity) => (totals[severity] ?? 0) > 0)
  const search = audit?.metrics?.search
  const authority = audit?.metrics?.authority

  return (
    <div className="mb-8 grid gap-5 md:grid-cols-2">
      <Card
        title="Site audit"
        href={`/findings?siteId=${site.id}`}
        linkLabel="All findings"
        foot={
          scorecard && raised.length > 0
            ? raised.map((severity) => (
                <span key={severity} className="tnum">
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                    {(totals[severity] ?? 0).toLocaleString('en-US')}
                  </span>{' '}
                  {severityLabel(severity)}
                </span>
              ))
            : undefined
        }
      >
        {scorecard ? (
          <>
            <Figure label="Open findings" value={openFindings.toLocaleString('en-US')} large />
            {scorecard.worstAxes.length > 0 && (
              <div className="text-muted text-[13px]">
                Look at first:{' '}
                {scorecard.worstAxes.map((axis) => AXIS_LABEL[axis] ?? axis).join(', ')}.
              </div>
            )}
          </>
        ) : (
          <NotMeasured reason="No completed audit yet. Run one and this fills in." />
        )}
      </Card>

      <Card
        title="Search performance"
        href={`/findings?siteId=${site.id}&axis=content`}
        foot={
          search ? (
            <>
              <span>
                Search Console, {search.startDate} to {search.endDate}
              </span>
              <span>Lags two to three days</span>
            </>
          ) : undefined
        }
      >
        {search ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Clicks" value={search.clicks.toLocaleString('en-US')} />
            <Figure label="Impressions" value={search.impressions.toLocaleString('en-US')} />
            <Figure label="Click-through" value={`${(search.ctr * 100).toFixed(1)}%`} />
            <Figure label="Avg position" value={search.position.toFixed(1)} />
          </div>
        ) : (
          <NotMeasured reason="Connect Google Search Console, then run an audit." />
        )}
      </Card>

      <Card
        title="AI visibility"
        href={`/visibility?siteId=${site.id}`}
        foot={
          visibility && !visibility.note && visibility.engines.length > 0 ? (
            <>
              <span>Polled on</span>
              <span>{visibility.engines.join(', ')}</span>
            </>
          ) : undefined
        }
      >
        {visibility && !visibility.note ? (
          <div className="grid grid-cols-3 gap-4">
            <Figure
              label="With a verdict"
              value={
                <>
                  {visibility.promptsMeasured}{' '}
                  <span
                    className="text-muted text-[13px]"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    of {visibility.promptsConfigured}
                  </span>
                </>
              }
            />
            <Figure label="Checks run" value={visibility.checksRun.toLocaleString('en-US')} />
            <Figure
              label="Share of voice"
              value={visibility.share ? `${Math.round(visibility.share.clientShare * 100)}%` : dash}
            />
          </div>
        ) : (
          /*
            The note says which kind of nothing: no prompts, none polled, or polling but short of
            a verdict. Three different answers, and none of them is a zero.
          */
          <NotMeasured
            reason={visibility?.note ?? 'Add the questions your customers ask, and polling starts.'}
          />
        )}
      </Card>

      <Card title="Authority" href={`/authority?siteId=${site.id}`}>
        {authority ? (
          <div className="grid grid-cols-3 gap-4">
            <Figure
              label="Earned media"
              value={
                authority.earnedDomains === null
                  ? dash
                  : authority.earnedDomains.toLocaleString('en-US')
              }
            />
            <Figure
              label="Referring"
              value={
                authority.referringDomains === null
                  ? dash
                  : authority.referringDomains.toLocaleString('en-US')
              }
            />
            <Figure
              label="Mention, no link"
              value={
                authority.unlinkedMentions
                  ? authority.unlinkedMentions.length.toLocaleString('en-US')
                  : dash
              }
            />
          </div>
        ) : (
          <NotMeasured reason="Needs a SERP data source, which is a paid dependency and off by default." />
        )}
      </Card>
    </div>
  )
}
