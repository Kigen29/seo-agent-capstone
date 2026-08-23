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

/** A card, so the grid is one shape rather than five hand-rolled ones. */
function Card({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string
  href?: string
  linkLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="card elev-sm gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="h-section m-0">{title}</h2>
        {href && (
          <Link href={href} className="shrink-0 text-[13px]">
            {linkLabel ?? 'More'} &rarr;
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/** A label and a figure, side by side. Tabular so a column of them does not wobble. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted min-w-0 truncate text-sm">{label}</span>
      <span className="tnum shrink-0">{value}</span>
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
  const search = audit?.metrics?.search
  const authority = audit?.metrics?.authority

  return (
    <div className="mb-8 grid gap-3 md:grid-cols-2">
      <Card title="Site audit" href={`/findings?siteId=${site.id}`} linkLabel="All findings">
        {scorecard ? (
          <>
            <Row label="Open findings" value={openFindings.toLocaleString('en-US')} />
            {SEVERITIES.filter((severity) => (totals[severity] ?? 0) > 0).map((severity) => (
              <Row
                key={severity}
                label={severityLabel(severity)}
                value={(totals[severity] ?? 0).toLocaleString('en-US')}
              />
            ))}
            {scorecard.worstAxes.length > 0 && (
              <p className="text-muted m-0 text-[13px]">
                Look at first:{' '}
                {scorecard.worstAxes.map((axis) => AXIS_LABEL[axis] ?? axis).join(', ')}.
              </p>
            )}
          </>
        ) : (
          <NotMeasured reason="No completed audit yet. Run one and this fills in." />
        )}
      </Card>

      <Card title="Search performance" href={`/findings?siteId=${site.id}&axis=content`}>
        {search ? (
          <>
            <Row label="Clicks" value={search.clicks.toLocaleString('en-US')} />
            <Row label="Impressions" value={search.impressions.toLocaleString('en-US')} />
            <Row label="Click-through rate" value={`${(search.ctr * 100).toFixed(1)}%`} />
            <Row label="Average position" value={search.position.toFixed(1)} />
            <p className="text-muted m-0 text-[13px]">
              Search Console, {search.startDate} to {search.endDate}. It lags two to three days.
            </p>
          </>
        ) : (
          <NotMeasured reason="Connect Google Search Console, then run an audit." />
        )}
      </Card>

      <Card title="AI visibility" href={`/visibility?siteId=${site.id}`}>
        {visibility && !visibility.note ? (
          <>
            <Row
              label="Prompts with a verdict"
              value={`${visibility.promptsMeasured} of ${visibility.promptsConfigured}`}
            />
            <Row label="Checks run" value={visibility.checksRun.toLocaleString('en-US')} />
            <Row
              label="Share of voice"
              value={
                visibility.share ? (
                  `${Math.round(visibility.share.clientShare * 100)}%`
                ) : (
                  <span className="text-subtle">&mdash;</span>
                )
              }
            />
          </>
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
          <>
            <Row
              label="Earned-media domains"
              value={authority.earnedDomains.toLocaleString('en-US')}
            />
            <Row
              label="Referring domains"
              value={
                authority.referringDomains === null ? (
                  <span className="text-subtle" aria-label="Not measured">
                    &mdash;
                  </span>
                ) : (
                  authority.referringDomains.toLocaleString('en-US')
                )
              }
            />
            {authority.unlinkedMentions && authority.unlinkedMentions.length > 0 && (
              <Row
                label="Mention you without linking"
                value={authority.unlinkedMentions.length.toLocaleString('en-US')}
              />
            )}
          </>
        ) : (
          <NotMeasured reason="Needs a SERP data source, which is a paid dependency and off by default." />
        )}
      </Card>
    </div>
  )
}
