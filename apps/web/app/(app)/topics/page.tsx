import type { Audit, FindingListItem, Site } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { TopicMapFigure } from '@/components/topic-map'
import { EmptyState } from '@/components/ui/empty-state'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { AdviceTable, GroupsTable } from './topic-tables'

export const dynamic = 'force-dynamic'

/**
 * Topics: what the site is about, measured, and what that suggests doing (ADR-0024, ADR-0035).
 *
 * The map has lived as one figure at the bottom of an audit, and its two findings arrive in the
 * inbox among sixty others. This page puts the measurement and the advice it produced in one
 * place, because neither makes sense without the other: "three pages have no hub" is only
 * readable next to which three pages were grouped and why.
 *
 * It adds no measurement of its own. The groups are the last audit's, and the advice is the
 * TOPIC findings that audit raised, read from the same inbox everything else uses.
 */

/** Every rule the topic map raises shares this prefix, which is what the inbox is searched for. */
const TOPIC_RULES = 'TOPIC-'

export const metadata = { title: 'Topics' }

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId } = await searchParams

  let sites: Site[]
  let site: Site | undefined
  let audit: Audit | undefined
  let advice: FindingListItem[] = []
  try {
    sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site?.latestAudit) {
      ;[audit, advice] = await Promise.all([
        api.getAudit(site.latestAudit.id),
        api
          .listFindings({ siteId: site.id, q: TOPIC_RULES, pageSize: 20 })
          // The search matches titles as well as rule ids, so keep only the topic rules.
          .then((page) =>
            page.findings.filter((finding) => finding.ruleId.startsWith(TOPIC_RULES)),
          ),
      ])
    }
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (!site) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="Research" title="Topics" />
        <EmptyState
          figure="0"
          title="No sites yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Add a site
            </Link>
          }
        >
          Add a site and run an audit, and its pages are grouped by subject here.
        </EmptyState>
      </main>
    )
  }

  const map = audit?.metrics?.topics
  const groups = map?.clusters.filter((cluster) => cluster.pages.length > 1) ?? []
  const alone = map?.clusters.filter((cluster) => cluster.pages.length === 1) ?? []
  const structure = audit?.scorecard?.axes.find((axis) => axis.axis === 'structure')

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Research"
        title="What is your site about?"
        description="The pages from your last audit, grouped by how alike their text is, and what that grouping suggests you link or write. The groups are measured. Only their names come from a model, and no advice here depends on a name."
      />

      {!audit && (
        <EmptyState
          figure="?"
          title="No audit yet"
          action={
            <Link href={`/dashboard?siteId=${site.id}`} className="btn btn-primary">
              Run an audit
            </Link>
          }
        >
          Topics are measured during an audit. Run one and the groups land here.
        </EmptyState>
      )}

      {/*
        Not measured is its own state, with its reason. The audit's structure note says which kind
        of nothing this is: no embedding model configured, too few pages, or a call that failed.
      */}
      {audit && !map && (
        <Note tone="warn" className="mb-6">
          Topics were not measured on the last audit, so there are no groups to show. That is an
          absence of measurement, not a site without topics.
          {structure?.coverage.note && (
            <span className="mt-2 block">{structure.coverage.note}</span>
          )}
        </Note>
      )}

      {audit && map && (
        <>
          <StatRow>
            {/* "k of N", so a map over part of the site says so. */}
            <Stat
              label="Pages compared"
              value={`${map.pagesEmbedded} of ${map.pagesCrawled}`}
              hint="Of the pages the audit read"
            />
            <Stat label="Groups" value={String(groups.length)} hint="Pages about one subject" />
            <Stat
              label="Standing alone"
              value={String(alone.length)}
              hint="Pages unlike any other"
            />
            <Stat
              label="Suggestions"
              hint="Things to link or to write"
              value={String(advice.length)}
              tone={advice.length > 0 ? 'accent' : undefined}
            />
          </StatRow>

          <section className="mb-8">
            <h2 className="h-section mb-3">The map</h2>
            <div className="card" style={{ padding: 'var(--space-5)' }}>
              <TopicMapFigure map={map} />
            </div>
          </section>
        </>
      )}

      {/*
        Outside the map block on purpose: a tracked question that no page covers is tested against
        titles and headings, needs no embeddings, and is raised whether or not the map was measured.
      */}
      {audit && (
        <section className="mb-8" aria-labelledby="advice-heading">
          <h2 id="advice-heading" className="h-section mb-1">
            What this suggests
          </h2>
          <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
            Two checks: whether each group of three or more pages has a page that links to at least
            half of the others, and whether each question you track for AI visibility has a page
            about it. Both need you to write something, so neither becomes a pull request.
          </p>

          {advice.length === 0 ? (
            <Note tone="info">
              Nothing raised on the last audit. That means one of two things for each check: it ran
              and passed, or there was nothing for it to test, such as no group of three pages or no
              tracked questions. The audit&rsquo;s scorecard says which checks ran.
            </Note>
          ) : (
            <AdviceTable advice={advice} />
          )}
        </section>
      )}

      {audit && map && groups.length > 0 && (
        <section>
          <h2 className="h-section mb-1">The groups, page by page</h2>
          <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
            Open a group to see which pages were put together. If they are not about one subject,
            the grouping is wrong and any advice built on it can be dismissed.
          </p>
          <GroupsTable groups={groups} />
        </section>
      )}
    </main>
  )
}
