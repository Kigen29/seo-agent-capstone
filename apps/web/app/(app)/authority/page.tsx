import type { Audit, Site, SiteProfile } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { InfoHint } from '@/components/ui/info-hint'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { OutreachWorkbench } from './outreach-workbench'

export const dynamic = 'force-dynamic'

/**
 * Authority: who talks about you, and who links to you, in that order.
 *
 * The ordering is the argument. Every other tool opens its off-page section with backlinks, and
 * the evidence does not support it: branded web mentions correlate 0.664 with AI Overview
 * visibility, backlinks 0.218, and 84% of AI citations come from earned media. So mentions lead
 * here and referring domains are a second signal.
 *
 * The most useful thing on the page is neither of those. It is the list of domains that already
 * wrote about you and did not link, which is only computable because both signals exist, and
 * which is a morning of email rather than a campaign.
 *
 * So the page is two parts and no more: four figures that say where the site stands, and one
 * "who to contact" section that holds every list an email could come out of. The lists and the
 * email composer are in `outreach-workbench.tsx`.
 */
export default async function AuthorityPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId } = await searchParams

  let sites: Site[]
  let audit: Audit | undefined
  // Kept out of the try, because the drafting control below needs to know which site it is
  // pitching for, and the resolved site used to be scoped to the block that fetched the audit.
  let site: Site | undefined
  // Only used to start the publication search from the site's market, so its failure costs a
  // prefilled field and nothing else.
  let profile: SiteProfile | null = null
  try {
    sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site) {
      ;[audit, profile] = await Promise.all([
        site.latestAudit ? api.getAudit(site.latestAudit.id) : Promise.resolve(undefined),
        api.getSiteProfile(site.id).catch(() => null),
      ])
    }
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (sites.length === 0) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="Research" title="Authority" />
        <EmptyState
          figure="0"
          title="No sites yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Add a site
            </Link>
          }
        >
          Add a site and run an audit, and this fills in.
        </EmptyState>
      </main>
    )
  }

  const authority = audit?.metrics?.authority
  const coverage = audit?.scorecard?.axes.find((axis) => axis.axis === 'authority')

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Research"
        title="Who mentions you, and who links to you"
        description="Other sites that write about your business, and the ones that link to it. For showing up in AI answers, being written about counts for more than being linked to, so mentions come first."
      />

      {!audit && (
        <EmptyState
          figure="—"
          title="No audit yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Run an audit
            </Link>
          }
        >
          Authority is measured during an audit. Run one and the numbers land here.
        </EmptyState>
      )}

      {audit && !authority && (
        <Note tone="warn">
          {coverage?.coverage.note ??
            'This axis was not measured on the last audit. It needs a SERP data source, which is a paid dependency and off by default.'}
          <span className="mt-2 block">
            This data source is not enabled for this deployment. Contact the application operator to
            enable authority measurement, then run another audit.
          </span>
        </Note>
      )}

      {/* Both, because `authority` derives from `audit` and the compiler cannot see that. */}
      {audit && authority && (
        <>
          <StatRow>
            <Stat
              label="Wrote about you"
              value={countOrDash(authority.earnedDomains)}
              hint="Independent sites, counted once each"
            />
            <Stat
              label="Your own channels"
              value={countOrDash(authority.selfPublishedDomains)}
              hint="Profiles and pages you control"
            />
            {/*
              A dash, never a zero. Null here means no backlink index is configured, and a zero
              would read as "nobody links to you", which is the opposite claim. ADR-0018 spends a
              page on this and a dashboard is the easiest place to undo it.
            */}
            <Stat
              label="Link to you"
              value={
                authority.referringDomains === null ? (
                  <span className="text-subtle">
                    &mdash;
                    {/* The dash alone reaches a sighted user; this reaches everyone else. */}
                    <span className="sr-only">Not measured: no backlink index is configured</span>
                  </span>
                ) : (
                  authority.referringDomains.toLocaleString('en-US')
                )
              }
              hint={authority.referringDomains === null ? 'Not measured' : 'Separate sites'}
            />
            <Stat
              label="Wrote about you, no link"
              tone={authority.unlinkedMentions?.length ? 'accent' : undefined}
              value={
                authority.unlinkedMentions ? (
                  authority.unlinkedMentions.length.toLocaleString('en-US')
                ) : (
                  <span className="text-subtle">
                    &mdash;<span className="sr-only">Not measured</span>
                  </span>
                )
              }
              hint="The quickest emails to win"
            />
          </StatRow>

          {authority.earnedDomains === null && coverage?.coverage.note && (
            <Note tone="info" className="mb-6">
              {coverage.coverage.note}
            </Note>
          )}

          {authority.referringDomains === null && (
            <Note tone="info" className="mb-6">
              Links to you were not counted, because no backlink index is switched on. The dash
              means &ldquo;not measured&rdquo;, not &ldquo;none&rdquo;. Mentions carry this page in
              the meantime, and they are the stronger signal.
            </Note>
          )}

          <section className="mt-8">
            <div className="mb-3 flex items-center gap-1">
              <h2 className="h-section m-0">Who to contact</h2>
              <InfoHint label="how these lists are ordered">
                Three lists, ordered by how likely a reply is. First, sites that already wrote about
                you. Second, sites that link to your competitors. Third, publications found by
                search. Every email is written here and sent by you, from your own address. We never
                send anything.
              </InfoHint>
            </div>
            {site && (
              <OutreachWorkbench
                key={site.id}
                siteId={site.id}
                unlinked={authority.unlinkedMentions}
                sampled={authority.referringDomainsSampled}
                gap={authority.linkGap}
                market={profile?.market}
              />
            )}
          </section>

          {/* A div: a paragraph here takes the stylesheet margin and ignores the utility. */}
          <div className="text-muted mt-8 text-[13px]">
            Measured on the audit of{' '}
            {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
              new Date(audit.startedAt),
            )}
            . Sites are counted once each, because ten pages on one news site is still one
            publication that covered you.
          </div>
        </>
      )}
    </main>
  )
}

/** A dash, never a zero, for a count that was not measured. */
function countOrDash(value: number | null) {
  return value === null ? (
    <span className="text-subtle">
      &mdash;<span className="sr-only">Not measured</span>
    </span>
  ) : (
    value.toLocaleString('en-US')
  )
}
