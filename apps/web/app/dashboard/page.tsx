import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleConnection } from '@/components/google-connection'
import { RepoCallback } from '@/components/repo-callback'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { startAudit, verifySite } from './actions'
import { AddSite } from './add-site'
import { ConnectRepo } from './connect-repo'

export const dynamic = 'force-dynamic'

/** The banner shown after a Verify-with-a-PR click, keyed on the ?verify= status. */
const VERIFY_MESSAGE: Record<string, { tone: string; text: string }> = {
  queued: {
    tone: 'note note-ok',
    text: 'Verification queued. The agent is opening a pull request that adds the meta tag; it will appear on the site shortly.',
  },
  precondition: {
    tone: 'note note-warn',
    text: 'Connect a repository and Google Search Console to this site first.',
  },
  failed: {
    tone: 'note note-error',
    text: 'Could not queue verification. Try again shortly.',
  },
}

/** Statuses that mean an audit is on the queue or running, so "Run audit" should read differently. */
const RUNNING = new Set(['queued', 'crawling', 'evaluating'])

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; github?: string; verify?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const {
    google: googleCallback,
    github: githubCallback,
    verify: verifyCallback,
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
    <main className="wrap">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <div className="card-kicker">Level</div>
          <h1 style={{ fontWeight: 400, margin: 0 }}>Your sites</h1>
        </div>
        <Link href="/findings">All findings &rarr;</Link>
      </div>
      <p style={{ marginTop: 'var(--space-2)', fontSize: 14, opacity: 0.75, maxWidth: '60ch' }}>
        Add a site and run an audit. The crawl runs on the worker and this page shows its progress
        live.
      </p>

      <GoogleConnection connection={connections.google} callback={googleCallback} />

      <RepoCallback callback={githubCallback} />

      {verifyMessage && (
        <p role="status" className={verifyMessage.tone} style={{ marginTop: 'var(--space-4)' }}>
          {verifyMessage.text}
        </p>
      )}

      <AddSite />

      {sites.length === 0 ? (
        <p style={{ marginTop: 'var(--space-8)', fontSize: 14, opacity: 0.7 }}>
          No sites yet. Add one above to run your first audit.
        </p>
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
                          <button type="submit" className="btn btn-primary">
                            Verify with a PR
                          </button>
                        </form>
                      )}

                    <form action={startAudit}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <button
                        type="submit"
                        disabled={Boolean(running)}
                        className="btn btn-secondary"
                      >
                        {running ? 'Running...' : 'Run audit'}
                      </button>
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
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
