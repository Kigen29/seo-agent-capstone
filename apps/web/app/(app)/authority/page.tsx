import type { Audit, Site } from '@seo/api-client'
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
  try {
    sites = await api.listSites()
    const site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site?.latestAudit) audit = await api.getAudit(site.latestAudit.id)
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
        title="Who talks about you, and who links to you"
        description="Mentions lead this axis on purpose. Branded web mentions correlate 0.664 with AI Overview visibility; backlinks correlate 0.218. Mention-building and link-building are two different jobs."
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
        </Note>
      )}

      {/* Both, because `authority` derives from `audit` and the compiler cannot see that. */}
      {audit && authority && (
        <>
          <StatRow>
            <Stat
              label="Earned-media domains"
              value={authority.earnedDomains.toLocaleString('en-US')}
            />
            <Stat
              label="Self-published"
              value={authority.selfPublishedDomains.toLocaleString('en-US')}
            />
            {/*
              A dash, never a zero. Null here means no backlink index is configured, and a zero
              would read as "nobody links to you", which is the opposite claim. ADR-0018 spends a
              page on this and a dashboard is the easiest place to undo it.
            */}
            <Stat
              label="Referring domains"
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
            />
            <Stat
              label="Mention, no link"
              value={
                authority.unlinkedMentions ? (
                  authority.unlinkedMentions.length.toLocaleString('en-US')
                ) : (
                  <span className="text-subtle">&mdash;</span>
                )
              }
            />
          </StatRow>

          {authority.referringDomains === null && (
            <Note tone="info" className="mb-6">
              Referring domains are not measured: no backlink index is configured. That is an
              absence of data, not a zero, and the two mean opposite things. Mentions carry this
              axis meanwhile, which the evidence says is the better signal anyway.
            </Note>
          )}

          {authority.unlinkedMentions && authority.unlinkedMentions.length > 0 && (
            <section className="mb-6">
              <h2 className="h-section mb-1">Already wrote about you, did not link</h2>
              <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
                The cheapest link work available. These publications have covered you, so the ask is
                small and the hit rate is far better than cold outreach. Check each one before you
                write: the comparison covers the top {authority.referringDomainsSampled ?? 'N'}{' '}
                referring domains by authority, so a link from outside that slice would look like an
                absence here.
              </p>
              <div className="card elev-sm gap-0 p-0">
                {authority.unlinkedMentions.map((domain, index) => (
                  <a
                    key={domain}
                    href={`https://${domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-3 text-[13px] break-all"
                    style={{
                      borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)',
                    }}
                  >
                    {domain}
                  </a>
                ))}
              </div>
            </section>
          )}

          {authority.unlinkedMentions?.length === 0 && (
            <Note tone="ok" className="mb-6">
              Every earned-media domain that mentions you already links to you. There is no
              unlinked-mention work to do here.
            </Note>
          )}

          <p className="text-muted m-0 text-[13px]">
            Measured on the audit of{' '}
            {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
              new Date(audit.startedAt),
            )}
            . Counted by domain rather than by result, because ten pages on one news site is one
            publication that covered you.
          </p>
        </>
      )}
    </main>
  )
}
