import type { Audit, VisibilityReport } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleCallbackNote } from '@/components/google-connection'
import { RepoCallback } from '@/components/repo-callback'
import { EmptyState } from '@/components/ui/empty-state'
import { Note, type NoteTone } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { SubmitButton } from '@/components/ui/submit-button'
import { handleApiError } from '@/lib/api-error'
import { getClient, getSites } from '@/lib/session'
import { startAudit } from '../actions'
import { AddSite } from '../add-site'
import { SetupChecklist } from '../setup-checklist'
import { Overview } from './overview'

export const dynamic = 'force-dynamic'

/** The banner shown after a Verify-with-a-PR click, keyed on the ?verify= status. */
const VERIFY_MESSAGE: Record<string, { tone: NoteTone; text: string }> = {
  queued: {
    tone: 'ok',
    text: 'Verification queued. The agent is opening a pull request that adds the meta tag; it will appear on the site shortly.',
  },
  precondition: {
    tone: 'warn',
    text: 'Connect a repository and Google Search Console to this site first.',
  },
  failed: {
    tone: 'error',
    text: 'Could not queue verification. Try again shortly.',
  },
}

/** Statuses that mean an audit is on the queue or running, so "Run audit" should read differently. */
const RUNNING = new Set(['queued', 'crawling', 'evaluating'])

/** The host, for a page title. A full URL as an h1 reads as a string rather than a name. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{
    google?: string
    github?: string
    verify?: string
    asleep?: string
    siteId?: string
  }>
}) {
  const api = await getClient()
  if (!api) return null

  const {
    google: googleCallback,
    github: githubCallback,
    verify: verifyCallback,
    asleep,
    siteId,
  } = await searchParams
  const verifyMessage = verifyCallback ? VERIFY_MESSAGE[verifyCallback] : undefined

  let sites
  let connections
  let audit: Audit | undefined
  let visibility: VisibilityReport | undefined
  try {
    ;[sites, connections] = await Promise.all([getSites(), api.getConnections()])

    /**
     * The overview is about one site, and the switcher in the sidebar says which. Falling back to
     * the first is what every other page here does, so arriving with no `siteId` shows something
     * rather than an empty frame.
     *
     * Settled rather than awaited together with the list: these two are the overview's detail and
     * a failure in either must not cost the site list, the connect flows, or the Add-site form,
     * which are what a user with nothing set up actually needs.
     */
    const active = siteId ? sites.find((site) => site.id === siteId) : sites[0]
    if (active) {
      const [auditResult, visibilityResult] = await Promise.allSettled([
        active.latestAudit ? api.getAudit(active.latestAudit.id) : Promise.resolve(undefined),
        api.getVisibilityReport(active.id),
      ])
      if (auditResult.status === 'fulfilled') audit = auditResult.value
      if (visibilityResult.status === 'fulfilled') visibility = visibilityResult.value
    }
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const activeSite = siteId ? sites.find((site) => site.id === siteId) : sites[0]

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Overview"
        title={activeSite ? hostOf(activeSite.url) : 'Your sites'}
        description="Where this site stands across the axes we can measure, and what is honestly unmeasured."
        actions={<Link href="/findings">All findings &rarr;</Link>}
      />

      <GoogleCallbackNote callback={googleCallback} />

      <RepoCallback callback={githubCallback} />

      {/*
        `startAudit` redirects here with ?asleep=1 when the API did not answer, and nothing read
        it: the parameter was set, the page destructured three other keys, and the user got a
        silent bounce back to the dashboard with their audit never queued and no explanation. The
        button appeared to do nothing at all.
      */}
      {asleep && (
        <Note tone="warn" className="mt-4">
          The API was waking up, so the audit was not queued. It sleeps after about fifteen minutes
          idle on the free tier. Try Run audit again in a moment.
        </Note>
      )}

      {verifyMessage && (
        <Note tone={verifyMessage.tone} className="mt-4">
          {verifyMessage.text}
        </Note>
      )}

      {activeSite && <SetupChecklist site={activeSite} google={connections.google} />}

      {activeSite && (
        <Overview
          site={activeSite}
          {...(audit ? { audit } : {})}
          {...(visibility ? { visibility } : {})}
        />
      )}

      <h2 className="h-section mb-3">Your sites</h2>

      <AddSite />

      {sites.length === 0 ? (
        <EmptyState figure="0" title="No sites yet">
          Add one above to run your first audit. Everything else in RankWright hangs off a site.
        </EmptyState>
      ) : (
        <div className="table-scroll mt-6">
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Last audit</th>
                <th>Pages</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const running = site.latestAudit && RUNNING.has(site.latestAudit.status)
                const isActive = site.id === activeSite?.id
                return (
                  <tr key={site.id}>
                    <td className="break-all">
                      {hostOf(site.url)}
                      {isActive && (
                        <span className="text-muted ml-2 text-[12px]">(shown above)</span>
                      )}
                    </td>
                    <td className="text-muted">
                      {site.latestAudit
                        ? `${site.latestAudit.status}, ${new Date(site.latestAudit.startedAt).toLocaleDateString()}`
                        : 'Never audited'}
                    </td>
                    <td className="tnum text-muted">
                      {site.latestAudit?.pagesCrawled ?? '\u2013'}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-end gap-3">
                        {!isActive && <Link href={`/dashboard?siteId=${site.id}`}>Set up</Link>}
                        {site.latestAudit && (
                          <Link href={`/audits/${site.latestAudit.id}`}>
                            {running ? 'View progress' : 'View audit'}
                          </Link>
                        )}
                        <form action={startAudit}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <SubmitButton
                            className="btn btn-secondary btn-sm"
                            pendingLabel="Queueing..."
                            disabled={Boolean(running)}
                          >
                            {running ? 'Running...' : 'Run audit'}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
