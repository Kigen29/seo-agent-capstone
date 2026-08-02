import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleConnection } from '@/components/google-connection'
import { RepoCallback } from '@/components/repo-callback'
import { EmptyState } from '@/components/ui/empty-state'
import { Note, type NoteTone } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { SubmitButton } from '@/components/ui/submit-button'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { startAudit, verifySite } from '../actions'
import { AddSite } from '../add-site'
import { ConnectRepo } from '../connect-repo'
import { VisibilityPrompts } from '../visibility-prompts'

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

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; github?: string; verify?: string; asleep?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const {
    google: googleCallback,
    github: githubCallback,
    verify: verifyCallback,
    asleep,
  } = await searchParams
  const verifyMessage = verifyCallback ? VERIFY_MESSAGE[verifyCallback] : undefined

  let sites
  let connections
  try {
    ;[sites, connections] = await Promise.all([api.listSites(), api.getConnections()])
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Sites"
        title="Your sites"
        description="Add a site and run an audit. The crawl runs on the worker and this page shows its progress live."
        actions={<Link href="/findings">All findings &rarr;</Link>}
      />

      <GoogleConnection connection={connections.google} callback={googleCallback} />

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

      <AddSite />

      {sites.length === 0 ? (
        <EmptyState figure="0" title="No sites yet">
          Add one above to run your first audit. Everything else in RankWright hangs off a site.
        </EmptyState>
      ) : (
        <div style={{ marginTop: 'var(--space-8)', display: 'grid', gap: 'var(--space-3)' }}>
          {sites.map((site) => {
            const running = site.latestAudit && RUNNING.has(site.latestAudit.status)

            return (
              <div key={site.id} className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 'var(--space-4)',
                    flexWrap: 'wrap',
                  }}
                >
                  <p className="card-title" style={{ margin: 0 }}>
                    {site.url}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      flexWrap: 'wrap',
                    }}
                  >
                    {site.latestAudit && (
                      <Link href={`/dashboard/audits/${site.latestAudit.id}`}>
                        {running ? 'View progress' : 'View audit'}
                      </Link>
                    )}

                    <ConnectRepo siteId={site.id} repoFullName={site.repoFullName ?? null} />

                    {site.repoFullName &&
                      connections.google.connected &&
                      (site.gscVerificationStatus ?? 'none') === 'none' && (
                        <form action={verifySite}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <SubmitButton pendingLabel="Queueing...">Verify with a PR</SubmitButton>
                        </form>
                      )}

                    <form action={startAudit}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <SubmitButton
                        className="btn btn-secondary"
                        pendingLabel="Queueing..."
                        disabled={Boolean(running)}
                      >
                        {running ? 'Running...' : 'Run audit'}
                      </SubmitButton>
                    </form>
                  </div>
                </div>

                {/* Status tags, so the connection and verification state is visible at a glance. */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  {site.repoFullName ? (
                    <span className="tag tag-outline">repo: {site.repoFullName}</span>
                  ) : (
                    <span className="tag tag-neutral">no repo connected</span>
                  )}

                  {site.gscVerificationStatus === 'verified' ? (
                    <span
                      className="tag"
                      style={{
                        background: 'var(--color-accent-100)',
                        color: 'var(--color-accent-800)',
                      }}
                    >
                      &#10003; Search Console verified
                    </span>
                  ) : site.gscVerificationStatus === 'merged' ? (
                    <span className="tag tag-neutral">verifying with Google&hellip;</span>
                  ) : site.gscVerificationStatus === 'pr_open' && site.gscVerificationPrUrl ? (
                    <a
                      href={site.gscVerificationPrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="tag tag-outline"
                    >
                      verification PR open: review &amp; merge &rarr;
                    </a>
                  ) : null}
                </div>

                <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
                  {site.latestAudit
                    ? `${site.latestAudit.status} · ${site.latestAudit.pagesCrawled} pages · ${new Date(site.latestAudit.startedAt).toLocaleString()}`
                    : 'Never audited'}
                </p>

                <VisibilityPrompts siteId={site.id} siteUrl={site.url} />
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
